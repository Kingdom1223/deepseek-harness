/**
 * 载具桥：把渲染进程的网络层整体搬到主进程。
 *
 * 官方 `dsh-client-connection` 定义了一个公开接缝 `globalThis.__DSH_TRANSPORT__`，
 * 允许外壳自行提供三个载体，原文是「a shell that owns a different physical
 * transport provides both halves here instead of forking this plugin」。
 * 桌面版正是这种外壳：
 *
 *   fetch      → 单次 RPC 调用，直接命中进程内已注册的 /api 路由
 *   openStream → Gateway 事件流，开一条回环 WebSocket 到我们自己刚绑定的端口
 *   loadBundle → 客户端插件包的字节，从磁盘读，不走 HTTP
 *
 * 结果是：页面的每一次请求都在进程内完成，没有任何一个字节经过网络栈。
 * 绑定在 127.0.0.1 上的那个随机端口只服务于我们自己发起的流，外部不可达，
 * 用户也不需要知道它存在。
 */
import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { bootInjections } from '@deepseek-ai/dsh-client-modules'
import {
  decodeTransportRequest,
  encodeTransportResponse,
} from '../shared/transport-codec.js'
import { APP_ROOT } from './paths.js'

/** 与官方 client-connection 保持同一个前缀常量。 */
const API_PATH = '/api'

/** Gateway 事件流的复用端点，与官方 api-gateway 的常量一致。 */
const STREAM_MUX_PATH = '/api/remote.mux'

/**
 * 从应用根解析显式依赖。不能锚在 process.cwd()：安装后的启动目录取决于快捷
 * 方式或调用者，通常不是 app.asar，最终会表现为事件流无限自动重连。
 */
const appRequire = createRequire(join(APP_ROOT, 'package.json'))

/** 单次 RPC 响应的字节上限，防止把整个进程拖进内存。 */
const MAX_RESPONSE_BYTES = 128 * 1024 * 1024

/**
 * 把一个「node:http 形态」的路由处理器当成直接函数调用。
 *
 * DSH 的 HTTP 路由都是 `(req, res) => void` 形状，自身不关心谁在驱动它们。
 * 这里合成 IncomingMessage / ServerResponse，等 handler 自己 end()，
 * 再收集成结构化结果。`req.url` 只需要路径部分——处理器自己会解析查询串。
 *
 * @param {(req: any, res: any) => unknown} handler - 已注册的路由处理器
 * @param {string} url - 相对 URL（含查询串）
 * @param {{method: string, headers: Headers | Record<string, string>, body?: Uint8Array}} init - 请求要素
 * @returns {Promise<Response>}
 */
function invokeRouteHandler(handler, url, init) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const headerPairs = [...new Headers(init.headers).entries()]
    /** @type {any} */
    const req = new Readable({ read() {} })
    req.url = url
    req.method = init.method
    req.headers = Object.fromEntries(headerPairs.map(([name, value]) => [name.toLowerCase(), value]))
    req.rawHeaders = headerPairs.flat()
    req.httpVersion = '1.1'
    req.httpVersionMajor = 1
    req.httpVersionMinor = 1
    req.complete = false
    req.aborted = false
    req.socket = { remoteAddress: '127.0.0.1', remoteFamily: 'IPv4', encrypted: false }

    /** @type {any} */
    const res = new Readable({ read() {} })
    res.statusCode = 200
    res.statusMessage = 'OK'
    res.headersSent = false
    res.finished = false
    /** @type {Record<string, string>} */
    res._headers = {}

    res.setHeader = (name, value) => {
      res._headers[String(name).toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value)
      return res
    }
    res.getHeader = (name) => res._headers[String(name).toLowerCase()]
    res.getHeaders = () => ({ ...res._headers })
    res.removeHeader = (name) => {
      delete res._headers[String(name).toLowerCase()]
    }
    res.hasHeader = (name) => Object.hasOwn(res._headers, String(name).toLowerCase())
    res.flushHeaders = () => {
      res.headersSent = true
    }
    res.writeHead = (status, reasonOrHeaders, maybeHeaders) => {
      res.statusCode = status
      if (typeof reasonOrHeaders === 'string') res.statusMessage = reasonOrHeaders
      const headers = typeof reasonOrHeaders === 'object' && reasonOrHeaders !== null ? reasonOrHeaders : maybeHeaders
      if (headers !== undefined) {
        for (const [name, value] of Object.entries(headers)) {
          if (value !== undefined) res.setHeader(name, value)
        }
      }
      res.headersSent = true
      return res
    }
    res.write = (chunk) => {
      if (chunk !== undefined && chunk !== null) res.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      return true
    }
    res.end = (chunk) => {
      if (res.finished) return res
      if (chunk !== undefined && chunk !== null) res.write(chunk)
      res.finished = true
      res.push(null)
      return res
    }
    res.destroy = () => {
      if (!res.finished) {
        res.finished = true
        res.push(null)
      }
      return res
    }
    res.writeContinue = () => {}

    const chunks = []
    let total = 0
    /** 已经应答过就不重复结算。 */
    let settled = false
    const settle = (action) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      action()
    }

    // 有些路由（例如把响应当作长连接的端点）不会在预期时间内 end()。
    // 没有兜底的话，这个 Promise 永不结算，调用方只会看到
    // "reply was never sent" 这种毫无信息量的报错。
    const timer = setTimeout(() => {
      settle(() =>
        reject(
          new Error(
            `路由 ${url} 在 ${String(Date.now() - started)}ms 内没有结束响应` +
              `（已写 status=${String(res.statusCode)} headersSent=${String(res.headersSent)} 字节=${String(total)}）`,
          ),
        ),
      )
    }, init.timeoutMs ?? 20_000)

    res.on('data', (chunk) => {
      total += chunk.length
      if (total > MAX_RESPONSE_BYTES) {
        settle(() => reject(new Error(`dsh-desktop: 路由响应超过 ${String(MAX_RESPONSE_BYTES)} 字节上限`)))
        return
      }
      chunks.push(chunk)
    })
    res.on('end', () => {
      settle(() =>
        resolve(new Response(
          res.statusCode === 101 || res.statusCode === 103 || res.statusCode === 204 ||
            res.statusCode === 205 || res.statusCode === 304
            ? null
            : Buffer.concat(chunks),
          {
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: res._headers,
          },
        ))
      )
    })
    res.on('error', (error) => settle(() => reject(error)))

    try {
      if (init.body !== undefined && init.body.byteLength > 0) req.push(Buffer.from(init.body))
      req.push(null)
      req.complete = true
      Promise.resolve(handler(req, res)).catch((error) => settle(() => reject(error)))
    } catch (error) {
      settle(() => reject(error))
    }
  })
}

/**
 * 载具对象：主进程侧的那一半。
 *
 * 令牌这层刻意复用官方实现而不是绕过它：`connection.authenticatedUrl()` 给出
 * 一个「根路径 + 进程令牌」的换票 URL，GET 一次它就会下发签名 cookie。
 * 我们把这枚 cookie 缓存下来，后续每次 RPC 都带着它——等同于浏览器在同一
 * 会话里做的事，只是不经过浏览器。
 */
export class DesktopTransport {
  /** 路由表只报一次，避免刷屏。 */
  #reportedRoutes = false
  /**
   * @param {object} deps
   * @param {() => any} deps.getWebServer - 取出活动 webServer 服务
   * @param {() => any} deps.getClientModules - 取出 clientModules 服务
   * @param {() => any} deps.getConnection - 取出 connection 服务
   * @param {(level: string, message: string) => void} [deps.log]
   */
  constructor(deps) {
    this.deps = deps
    this.log = deps.log ?? (() => {})
    /** @type {Promise<string> | undefined} 会话 cookie（含属性前的 name=value 部分） */
    this.session = undefined
  }

  /** 本进程 API 载体的回环源。 */
  get origin() {
    const webServer = this.deps.getWebServer()
    if (webServer === undefined) throw new Error('dsh-desktop: DSH 运行时尚未就绪')
    return `http://${String(webServer.host)}:${String(webServer.port)}`
  }

  /**
   * 建立一次浏览器会话：用进程令牌换签名 cookie。
   * 幂等，失败后允许重试（例如运行时被重建）。
   * @returns {Promise<string>} cookie 的 `name=value` 部分，失败时返回空串
   */
  async ensureSession() {
    this.session ??= this.#handshake().catch((error) => {
      this.session = undefined
      this.log('warn', `会话握手失败：${String(error)}`)
      return ''
    })
    return this.session
  }

  /** @returns {Promise<string>} cookie 的 `name=value` 部分，未建立时为空串 */
  async #handshake() {
    const connection = this.deps.getConnection()
    if (connection === undefined) {
      this.log('warn', '认证握手：connection 服务不可用')
      return ''
    }
    const authority = new URL(this.origin).host
    this.log('info', `认证握手开始（authority ${authority}）`)

    // 直接调用官方认证入口做一次「令牌换 cookie」。它是进程内函数，
    // 所以这一步不需要真的发一个 HTTP 请求——只是借用它的签名逻辑。
    // 失败时把 401 的原因带出来，而不是静默降级。
    const authenticated = connection.authenticatedUrl(this.origin)
    const token = new URL(authenticated).searchParams.get('token') ?? ''
    const result = await invokeRouteHandler(
      (req, res) => connection.authorizeIndex(req, res),
      `/?token=${encodeURIComponent(token)}`,
      { method: 'GET', headers: { host: authority } },
    )
    this.log('info', `认证握手返回 ${String(result.status)}`)

    if (result.status !== 303) {
      throw new Error(
        `认证握手返回 ${String(result.status)}，期望 303 换票重定向` +
          (result.status === 401 ? '（进程令牌未被接受）' : ''),
      )
    }

    const setCookie = result.headers.get('set-cookie') ?? ''
    const pair = String(setCookie).split(';')[0]
    if (!pair.startsWith('dsh-auth-')) throw new Error(`认证握手未下发会话 cookie：${JSON.stringify(setCookie)}`)
    this.log('info', `浏览器会话已建立（authority ${authority}）`)
    return pair
  }

  /**
   * 处理一次 RPC 调用。
   * @param {unknown} envelope
   * @returns {Promise<{version: number, status: number, statusText: string, headers: Record<string, string>, bodyBase64: string}>}
   */
  async fetch(envelope) {
    const decoded = decodeTransportRequest(envelope)
    const request = new Request(decoded.url, {
      method: decoded.method,
      headers: decoded.headers,
      ...(decoded.body === undefined ? {} : { body: decoded.body }),
    })
    return encodeTransportResponse(await this.forwardRequest(request, { apiOnly: true }))
  }

  /**
   * 把标准 Request 交给 Harness 宿主路由。自定义协议和 IPC 都走这里，避免两套
   * 分发规则随官方升级逐渐分叉。
   *
   * @param {Request} request
   * @param {{apiOnly?: boolean}} [options]
   * @returns {Promise<Response>}
   */
  async forwardRequest(request, options = {}) {
    const webServer = this.deps.getWebServer()
    if (webServer === undefined) throw new Error('dsh-desktop: DSH 运行时尚未就绪，无法处理 RPC')

    // 页面里的 fetch 会用绝对 URL（`app://shell/api/...`），所以这里只取
    // 路径与查询串，忽略它来自哪个来源——渲染进程能发来的请求已经由 IPC 边界
    // 限定住了，来源本身没有额外的判断价值。
    const parsed = new URL(request.url, `${this.origin}/`)
    const pathname = parsed.pathname
    if (options.apiOnly === true && !pathname.startsWith(API_PATH)) {
      throw new Error(`dsh-desktop: 只转发 ${API_PATH} 前缀的请求，收到 ${pathname}`)
    }

    // 命中 webserver 自己的路由表（/api 是按前缀注册的共享通道）。
    const route = webServer.match(pathname)
    const connection = this.deps.getConnection()
    if (route === undefined) throw new Error(`dsh-desktop: 没有路由可以处理 ${pathname}`)

    const relative = `${pathname}${parsed.search}`
    /** @type {Record<string, string>} */
    const headers = new Headers(request.headers)
    // 认证层的 authority 检查要求 Host 与握手时完全一致，否则 cookie 名对不上。
    headers.set('host', new URL(this.origin).host)
    const cookie = await this.ensureSession()
    if (cookie !== '') {
      const existing = headers.get('cookie')
      headers.set('cookie', existing === null ? cookie : `${existing}; ${cookie}`)
    }
    if (!headers.has('content-type') && request.method !== 'GET' && request.method !== 'HEAD') {
      headers.set('content-type', 'application/json')
    }

    this.log('debug', `rpc ${request.method} ${relative}`)
    const body = request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : new Uint8Array(await request.arrayBuffer())
    const init = { method: request.method, headers, ...(body === undefined ? {} : { body }) }

    // 载具形态分两类，混用会静默挂死：
    //
    //   * `connection.fetch.register()` 注册的**精确路由**拿到的是 WHATWG Request
    //     并返回 Response（`/api/settings/describe`、`/api/credentials/describe`、
    //     `/api/dynamicCordisRunner/*` 都是这一类）。
    // 载具形态分三类，混用会静默挂死：
    //
    //   1. `connection.fetch.register()` 注册的**精确路由**：以 WHATWG
    //      Request/Response 为边界。只有少数几条（会话导出、上传、present 等）。
    //   2. `connection.rpc.intercept('/api', …)` 注册的**共享通道端点**：同样以
    //      Request/Response 为边界，由官方 `createSharedFetchHandler('/api')`
    //      分发。`/api/settings/describe`、`/api/credentials/describe`、
    //      `/api/dynamicCordisRunner/*` 都在这一类。
    //   3. `connection.rpc.handle()` 注册的 **RPC 通道**：拿到 node:http 的
    //      `req, res`。
    //
    // 用第 3 类的方式去驱动前两类，会得到一个永不 end() 的响应——调用方只会
    // 看到「回执永远不来」，没有任何可读线索。
    const exact = connection?.fetchRoutes?.get(pathname)
    if (exact !== undefined && exact.methods.has(request.method)) {
      return exact.fetch(
        new Request(new URL(relative, this.origin), {
          method: request.method,
          headers,
          ...body === undefined ? {} : { body },
        }),
      )
    }

    // 共享通道交给官方分发器，比自己判断 endpoint 归属可靠。
    // 认领判据用它自己的 404：没认领就交回路由表。
    if (connection !== undefined && typeof connection.createSharedFetchHandler === 'function') {
      const shared = connection.createSharedFetchHandler(API_PATH)
      const response = await shared.fetch(
        new Request(new URL(relative, this.origin), {
          method: request.method,
          headers,
          ...body === undefined ? {} : { body },
        }),
      )
      if (response.status !== 404) return response
    }

    try {
      return await invokeRouteHandler(route.handler, relative, init)
    } catch (error) {
      // 把真实原因回给渲染进程，而不是让它在 502 里猜。
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
      this.log('warn', `RPC ${relative} 处理失败：${detail}`)
      throw error
    }
  }

  /**
   * 渲染进程引导所需的全部数据，一次性交给 preload。
   *
   * 这是同步 IPC（`ipcRenderer.sendSync`）服务的：preload 必须在文档任何脚本
   * 之前把 `__ModuleLoader__` 门面与 `__DSH_BOOT__` 装好，而官方原本是靠
   * 内联 `<script>` 做这件事的。桌面版的页面通道是自定义协议，
   * 内联脚本在这里不执行，所以改成由 preload 直接注入——更早也更可靠。
   *
   * @param {Record<string, string>} bootPreferences - preload 从命令行带来的偏好（主题等）
   * @returns {{moduleLoaderQueue: any[], bootGraph: unknown, preferences: Record<string, string>}}
   */
  bootstrapPayload(bootPreferences) {
    const clientModules = this.deps.getClientModules()
    if (clientModules === undefined) throw new Error('dsh-desktop: clientModules 未就绪')
    const graph = clientModules.graph()
    const rows = bootInjections(graph)
    const queueScript = rows.find((row) => row.kind === 'script' && typeof row.text === 'string' && row.text.includes('__ModuleLoader__'))
    const graphRow = rows.find((row) => row.kind === 'global' && row.name === '__DSH_BOOT__')
    if (queueScript === undefined || graphRow === undefined) {
      throw new Error('dsh-desktop: 官方 bootInjections 里没有找到队列脚本或模块图')
    }
    return {
      // 队列脚本是一段自执行的源码：求值它就得到官方的门面实现，
      // 比在这里重写一遍协议更不容易走偏。
      queueScript: queueScript.text,
      bootGraph: graphRow.value,
      preferences: bootPreferences,
    }
  }

  /**
   * 读取一个已构建的客户端插件包字节。
   *
   * `clientModules.fetchBundle` 就是官方为「没有 Web 服务器的外壳」准备的入口
   * （文档原话：「Serve an advertised revisioned bundle or source map without a Web
   * server」）。它按 URL 里的 rev 从磁盘读该包的 `lib/client.js` 或 source map，
   * 未知 URL 返回 404、不支持的方法返回 405。
   *
   * @param {string} url - 形如 `/plugins/<encoded-id>/client.js?rev=<hash>`
   * @returns {Promise<{body: string, contentType: string}>}
   */
  async loadBundle(url) {
    const clientModules = this.deps.getClientModules()
    if (clientModules === undefined) throw new Error('dsh-desktop: clientModules 服务未挂载')

    const parsed = new URL(url, 'http://dsh.internal')
    const response = clientModules.fetchBundle({ method: 'GET', url: `${parsed.pathname}${parsed.search}` })
    if (!response.ok) {
      throw new Error(`dsh-desktop: 客户端包 ${url} 返回 ${String(response.status)}`)
    }

    return {
      body: await response.text(),
      contentType: response.headers.get('content-type') ?? 'text/javascript; charset=utf-8',
    }
  }

  /**
   * 读取任意本地文本文件（主题 CSS、桌面层脚本等由主进程持有的资源）。
   * @param {string} absolutePath - 绝对路径
   * @returns {Promise<string>} 文件内容
   */
  async readResource(absolutePath) {
    await access(absolutePath)
    return readFile(absolutePath, 'utf8')
  }

  /** @type {Map<string, import('ws').WebSocket>} 活动载体，用于反向投递渲染进程发来的帧。 */
  carriers = new Map()

  /**
   * 把一个渲染进程发来的帧投递给对应载体的物理套接字。
   * @param {string} carrierId - 载体标识
   * @param {{kind: string, text?: string, code?: number, reason?: string}} message - 帧
   */
  deliverToCarrier(carrierId, message) {
    const socket = this.carriers.get(carrierId)
    if (socket === undefined) {
      // 没有对应载体通常意味着 carrierId 不匹配——这类问题不报出来就只能靠猜。
      this.log('warn', `投递到未知载体 ${String(carrierId)}（活动载体 ${String(this.carriers.size)} 个）`)
      return
    }
    if (message === null || typeof message !== 'object') return
    if (message.kind === 'send' && typeof message.text === 'string') {
      this.log('info', `载体上行 ${carrierId}：${message.text.slice(0, 120)}`)
      if (socket.readyState === 1) socket.send(message.text)
      return
    }
    if (message.kind === 'close') {
      this.log('info', `事件流关闭 ${carrierId}（code=${String(message.code ?? 1000)}）`)
      try {
        socket.close(message.code ?? 1000, message.reason ?? '')
      } catch {
        /* 已关闭 */
      }
    }
  }

  /**
   * 桥接一条 Gateway 事件流。
   *
   * 官方客户端 `RemoteStreamMuxClient` / in-process 迭代器最终都需要「一条能收发
   * 字节的载体」。物理套接字由主进程持有（页面在 `app://` 下拿不到合法的同源
   * WebSocket），帧经普通 IPC 双向搬运。协议本身（streamId、open/cancel、
   * item/end/error）仍由官方客户端与官方服务端处理，这里只做字节搬运。
   *
   * @param {{endpoint?: string, carrierId?: string, payload?: {url?: string}}} request - 端点与负载
   * @param {{post: (frame: unknown) => void}} carrier - 渲染进程侧的帧投递器
   * @returns {Promise<void>} 套接字关闭后 resolve
   */
  async openStream(request, carrier) {
    // carrierId 由渲染进程生成并随请求带来：反向投递（渲染 → 主进程的帧）
    // 要用同一个键才能落到正确的套接字上。
    const carrierId = typeof request?.carrierId === 'string' && request.carrierId !== '' ? request.carrierId : `carrier-${String(Date.now())}`
    const cookie = await this.ensureSession()

    // 目标地址可能由调用方给出（WebSocket 接管路径：页面里算出的是
    // `ws://dsh.internal/api/remote.mux`，那是个占位来源，必须换成真实的回环源），
    // 也可能省略（自带载具路径：直接用 Gateway 的复用端点）。
    const requested = typeof request?.payload?.url === 'string' ? request.payload.url : undefined
    const path = requested === undefined ? STREAM_MUX_PATH : new URL(requested).pathname
    const url = new URL(path, this.origin)
    url.protocol = 'ws:'

    const { WebSocket } = appRequire('ws')
    const headers = { host: new URL(this.origin).host }
    if (cookie !== '') headers.cookie = cookie

    this.log('info', `事件流连接 ${url.href}（cookie ${cookie === '' ? '无' : '有'}，carrier ${carrierId}）`)
    const socket = new WebSocket(url.href, { headers })
    this.carriers.set(carrierId, socket)

    return new Promise((resolve) => {
      let settled = false
      /** 幂等收尾。 */
      const finish = (frame) => {
        if (settled) return
        settled = true
        this.carriers.delete(carrierId)
        try {
          carrier.post(frame)
        } catch {
          /* 接收端可能已经走了 */
        }
        try {
          socket.close()
        } catch {
          /* 已关闭 */
        }
        resolve()
      }

      socket.on('open', () => {
        this.log('info', `事件流已接通 ${url.pathname}`)
        carrier.post({ kind: 'open' })
      })
      socket.on('unexpected-response', (_request, response) => {
        this.log('warn', `事件流被拒绝：HTTP ${String(response.statusCode)}`)
        finish({ kind: 'close', code: 1008, reason: `HTTP ${String(response.statusCode)}` })
      })
      socket.on('message', (data) => carrier.post({ kind: 'message', text: String(data) }))
      socket.on('error', (error) => {
        this.log('warn', `事件流错误：${String(error?.message ?? error)}`)
        finish({ kind: 'error', message: String(error?.message ?? error) })
      })
      socket.on('close', (code, reason) => finish({ kind: 'close', code, reason: String(reason ?? '') }))
    })
  }

  /** 取消一次进行中的调用。 */
  abort(id) {
    this.inflight.get(id)?.abort()
    this.inflight.delete(id)
  }
}

/**
 * 把各种可能的响应体统一成文本。
 * @param {unknown} value - Buffer / Uint8Array / string / Response / { body: string }
 * @returns {Promise<string>} 文本
 */
async function toText(value) {
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8')
  if (value instanceof Response) return value.text()
  if (value !== null && typeof value === 'object' && 'body' in value) {
    return toText(/** @type {{body: unknown}} */ (value).body)
  }
  throw new Error('dsh-desktop: 无法识别的响应体类型')
}

export { API_PATH, invokeRouteHandler, toText }
