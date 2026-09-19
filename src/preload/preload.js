/**
 * 预加载：把渲染进程的网络层换成 IPC，并暴露一组窄接口给桌面层。
 *
 * 这是整个桌面方案的关键一步。官方 `dsh-client-connection` 公开了一个接缝：
 *
 *   globalThis.__DSH_TRANSPORT__ = { fetch, openStream, loadBundle, ownsHost }
 *
 * 官网文档对它的描述是：一个拥有不同物理载具的外壳在这里提供两个半边，
 * 而不必去 fork 这个插件。桌面版正是这种外壳——浏览器版把这三个动作交给
 * HTTP 与 WebSocket，桌面版把它们交给主进程。
 *
 * 结果是页面的每一次 RPC、每一个客户端插件包、每一条事件流都在进程内完成，
 * 没有一个字节经过网络栈。`ownsHost: true` 进一步告诉运行时：
 * 「这个页面就是宿主本身」，因此特权面（打开文件、写工作区）无需再经过
 * loopback 判定。
 *
 * 时序注意：本文件在文档任何脚本之前执行，而 shell 是在 application batch
 * 才读取这个全局，所以这里同步赋值是安全的。
 *
 * 关于 contextIsolation：桌面版刻意关闭它，因为官方的物理载具接缝
 * （`globalThis.__DSH_TRANSPORT__`）就是「外壳在自己的全局上放一个对象」——
 * preload 若跑在隔离世界里，页面读不到它，接缝静默失效。
 * 关闭隔离后 preload 与页面共享同一个全局，所以这里**不用 contextBridge**，
 * 直接赋值即可（contextBridge 在关闭隔离时也不可用）。
 */
import { ipcRenderer } from 'electron'
import { decodeTransportResponse, encodeTransportRequest } from '../shared/transport-codec.js'

/** 主进程通过 additionalArguments 传来的启动参数。 */
const bootArg = process.argv.find((arg) => arg.startsWith('--dsh-desktop-preload='))
const boot = bootArg === undefined ? {} : JSON.parse(decodeURIComponent(bootArg.slice('--dsh-desktop-preload='.length)))

// ── 1. 载具接缝 ────────────────────────────────────────────────────────────

/**
 * 把主进程返回的 { status, headers, bodyBase64 } 还原成真正的 Response。
 * base64 是为了让任意二进制体都能无损穿过结构化克隆。
 * @param {{status: number, headers: Record<string, string>, bodyBase64: string}} result - 主进程结果
 * @returns {Response} 还原出的响应
 */
const toResponse = decodeTransportResponse

/**
 * 单次 RPC：渲染进程 → 主进程 → 进程内路由 → 还原成 Response。
 * 签名与全局 fetch 一致，因此对上层完全透明。
 * @param {RequestInfo | URL} input - 请求 URL 或完整 Request
 * @param {RequestInit} [init] - 请求初始化
 * @returns {Promise<Response>} 响应
 */
async function transportFetch(input, init = {}) {
  let request
  let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

  try {
    request = await encodeTransportRequest(input, init, `${String(Date.now())}-${Math.random().toString(36).slice(2)}`)
    url = request.url
    const result = await ipcRenderer.invoke('dsh:transport:fetch', request)
    return toResponse(result)
  } catch (error) {
    // 主进程抛错时也要给出一个合法的 Response，否则上层会把「管道坏了」
    // 误报成「服务端返回了非 JSON」。
    // 这里刻意用字符串拼接而不是传对象：Electron 的 console-message 事件对
    // 多参数的对象格式化不稳定，日志丢过一次就够难查了。
    console.error('[dsh-desktop] RPC IPC 失败 url=' + url + ' 原因=' + String(error?.message ?? error) + ' 栈=' + String(error?.stack ?? '').slice(0, 400))
    return new Response(JSON.stringify({ error: String(error?.message ?? error) }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }
}

/**
 * Gateway 事件流载体。
 *
 * 官方客户端 `RemoteStreamMuxClient` 期望的是一个真正的 `WebSocket`：它会读
 * `readyState`、调用 `close(code, reason)`、用 `send()` 发 open/cancel。但页面在
 * `file://` 下拿不到合法的同源 WebSocket。
 *
 * 所以这里实现一个行为等价的替身：主进程持有真的套接字，渲染进程看到同一个
 * 对象的行为。`remoteStreamUrl()` 在 `file://` 下会退化成 `http://dsh.internal`
 * 的 `ws:` 形式，URL 本身不再有意义——真正的目标地址由主进程决定。
 *
 * 协议（streamId、open/cancel、item/end/error）全部由官方客户端自己处理，
 * 这里只做字节搬运。
 *
 * @param {string} endpoint - Typert Remote 流端点
 * @param {unknown} payload - wire 上的端点请求
 * @param {AbortSignal} signal - 该逻辑流的取消信号
 * @returns {AsyncIterable<unknown>} 服务端消息对象流
 */
function transportOpenStream(endpoint, payload, signal) {
  /**
   * 共用一条物理连接、按 streamId 分发逻辑流的复用器。
   *
   * 为什么要自己实现协议：官方对两条取流路径的期待完全不同。
   * WebSocket 路径（`RemoteStreamMuxClient`）内部处理协议，要求载具提供一个
   * 真正的 `WebSocket`；而 in-process 路径（`connection.rpc.open`）由
   * `normalizeConnectionStream` 直接 `yield*`，`ClientRemoteEvents.pumpEvents`
   * 拿到的是**已解析的帧对象**并直接读 `value.clientId` / `value.event`。
   * 所以这条路径上协议必须由载具实现——下面就是 Gateway 的 open 协议。
   */
  const mux = acquireMux()

  return {
    async *[Symbol.asyncIterator]() {
      const streamId = `s-${String(Date.now())}-${Math.random().toString(36).slice(2)}`
      const inbox = []
      let wake
      let failure
      let terminal = false

      mux.subscribe(streamId, (frame) => {
        if (frame.type === 'item') inbox.push(frame.value ?? null)
        else if (frame.type === 'end') terminal = true
        else if (frame.type === 'error') failure = frame.error
        wake?.()
      })

      const abort = () => {
        terminal = true
        mux.send({ type: 'cancel', streamId })
        wake?.()
      }
      signal?.addEventListener('abort', abort, { once: true })

      mux.send({ type: 'open', streamId, endpoint, payload })

      try {
        while (true) {
          if (inbox.length > 0) {
            yield inbox.shift()
            continue
          }
          if (failure !== undefined) throw new Error(failure.message ?? 'Remote stream failed')
          if (terminal || signal?.aborted === true) return
          await new Promise((resolve) => {
            wake = resolve
          })
          wake = undefined
        }
      } finally {
        signal?.removeEventListener('abort', abort)
        mux.unsubscribe(streamId)
        if (!terminal) mux.send({ type: 'cancel', streamId })
      }
    },
  }
}

/**
 * 取得（或惰性建立）Gateway 复用载体。
 *
 * 三个逻辑流（`$events` / `session/control` / `workspace/follow`）共用同一条
 * 物理连接——与官方 `RemoteStreamMuxClient` 的设计一致，也让握手只发生一次。
 *
 * @returns {{subscribe: Function, unsubscribe: Function, send: Function}} 复用器
 */
function acquireMux() {
  if (sharedMux !== undefined) return sharedMux

  /** @type {Map<string, (frame: any) => void>} */
  const sinks = new Map()
  /** @type {unknown[]} 连接就绪前积压的出站帧 */
  const outbox = []
  /**
   * 连接级 opening 帧的队列。
   *
   * `$events` 的 generation 靠它开张：`pumpEvents` 把迭代器产出的第一项当作
   * `{clientId, host}` 读（`parseRemoteEventReady`）。它不带 streamId ——
   * 它是**连接级**的开场，不是某个逻辑流的项，所以交给最先到达的订阅者。
   */
  const openings = []
  let open = false

  const carrierId = `mux-${String(Date.now())}-${Math.random().toString(36).slice(2)}`
  const carrier = openCarrier(carrierId, { endpoint: '$mux', payload: {} }, (frame) => {
    if (frame?.kind === 'open') {
      open = true
      for (const pending of outbox.splice(0)) send(pending)
      return
    }
    if (frame?.kind === 'message') {
      let parsed
      try {
        parsed = JSON.parse(frame.text)
      } catch {
        return
      }
      if (parsed?.streamId === undefined) openings.push(parsed)
      else sinks.get(parsed.streamId)?.(parsed)
      return
    }
    if (frame?.kind === 'close' || frame?.kind === 'error') {
      // 物理连接断了：让所有在途逻辑流结束，由上层触发重连。
      for (const sink of [...sinks.values()]) sink({ type: 'end', streamId: '' })
      open = false
    }
  })

  const send = (message) => {
    const text = JSON.stringify(message)
    if (!open) {
      outbox.push(message)
      return
    }
    void carrier.then((handle) => handle.post({ kind: 'send', text }))
  }

  sharedMux = {
    subscribe: (streamId, sink) => {
      sinks.set(streamId, sink)
      // 连接级开场先于任何逻辑流到达，所以订阅时把积压的开场交给它。
      const opening = openings.shift()
      if (opening !== undefined) sink(opening)
    },
    unsubscribe: (streamId) => sinks.delete(streamId),
    send,
  }
  // 载体建立后把积压的 open 帧发出去。
  void carrier.then(() => {
    for (const pending of outbox.splice(0)) send(pending)
  })
  return sharedMux
}

/** @type {{subscribe: Function, unsubscribe: Function, send: Function} | undefined} */
let sharedMux

/**
 * 客户端插件包的字节。官方在 `__DSH_TRANSPORT__.loadBundle` 存在时
 * 就用它替换默认的 `<script src>` 装载方式。
 * @param {string} url - 包的 revision URL
 * @returns {Promise<void>} 装载完成
 */
async function transportLoadBundle(url) {
  const result = await ipcRenderer.invoke('dsh:transport:bundle', url)
  await waitForHead()
  return evaluateBundle(result.body)
}

/**
 * 在页面里执行一个客户端插件包。
 *
 * 官方 bundle 是懒 CJS 表：脚本体只调用 `__ModuleLoader__.load({id, factory})`
 * 注册工厂，真正的模块体（含 CSS 注入）要到首次 import 才执行。
 * 所以这里用 script 元素执行而不是 eval，保留 sourceURL 以便调试，
 * 也保留与浏览器版完全一致的执行语义。
 *
 * @param {string} source - 包源码
 * @returns {Promise<void>} 注册完成
 */
function evaluateBundle(source) {
  return new Promise((resolve, reject) => {
    const element = document.createElement('script')
    element.textContent = `${source}\n//# sourceURL=dsh-desktop-bundle.js`
    element.addEventListener('error', () => reject(new Error('dsh-desktop: 客户端包执行失败')), { once: true })
    document.head.append(element)
    element.remove()
    resolve()
  })
}

/**
 * 等待 React 把应用挂到 `#root`。
 *
 * 桌面层要往 `body` 上追加标题栏。如果在 React 首次提交**之前**追加，
 * 轻则被覆盖，重则让 React 的挂载点对不上。所以等到 `#root` 里出现子节点为止；
 * 超时也放行——宁可标题栏晚一点，也不要因为等待而完全不出现。
 *
 * @param {number} [timeoutMs] - 最长等待时间
 * @returns {Promise<void>} 挂载完成或超时
 */
async function waitForAppMount(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const root = document.getElementById('root')
    if (root !== null && root.childElementCount > 0) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  console.warn('[dsh-desktop] 等待应用挂载超时，桌面层仍会注入')
}

/**
 * 等 `<head>` 出现。
 *
 * preload 在文档最早期运行，那时 `document.head` 还是 null。官方的 shell 是
 * module script（默认 defer），要等文档解析完成才执行，所以这里用微任务轮询
 * 等 head 出现完全来得及——比在 preload 里就急着找 head 可靠得多。
 *
 * @returns {Promise<HTMLHeadElement>} 可用的 head 元素
 */
async function waitForHead() {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    if (document.head !== null) return document.head
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('dsh-desktop: 等待 <head> 超时')
}

globalThis.__DSH_TRANSPORT__ = {
  fetch: transportFetch,
  openStream: transportOpenStream,
  loadBundle: transportLoadBundle,
  // 页面就是宿主本身：特权面无需 loopback 判定。
  ownsHost: true,
}

// 自检：确认这些全局真的落在了页面能读到的那个世界上。
// 关闭上下文隔离后 preload 与页面共享全局，这一行就是那个假设的验证点。
console.log(
  '[dsh-desktop] 载具已安装 world=' +
    (globalThis === window ? 'shared' : 'isolated') +
    ' transport=' +
    (globalThis.__DSH_TRANSPORT__ === undefined ? '缺失' : Object.keys(globalThis.__DSH_TRANSPORT__).join('+')) +
    ' desktopApi=' +
    (globalThis.dshDesktop === undefined ? '缺失' : 'ok'),
)

/**
 * 载体通道。
 *
 * 这里刻意**不用 MessagePort**：主进程建的端口通过 `window.postMessage` 回传
 * 这条路在本宿主里不通（`invoke` 正常、端口却收不到），而且失败是静默的。
 * 改成两条普通 IPC 通道——它们都已在本进程里验证可用：
 *
 *   主进程 → 渲染进程：`ipcRenderer.on('dsh:carrier:frame')`
 *   渲染进程 → 主进程：`ipcRenderer.send('dsh:carrier:post')`
 *
 * 每条帧带 `carrierId`，所以多个并发流（`$events` / `session/control` /
 * `workspace/follow`）共用这两条通道也不会串。
 */

/** @type {Map<string, (frame: any) => void>} 按 carrierId 分发的帧接收器。 */
const carrierSinks = new Map()

ipcRenderer.on('dsh:carrier:frame', (_event, payload) => {
  const sink = carrierSinks.get(payload?.carrierId)
  if (sink === undefined) return
  sink(payload.frame)
})

/**
 * 为一个逻辑流建立载体。
 * @param {string} carrierId - 载体标识
 * @param {Record<string, unknown>} request - 端点与负载
 * @param {(frame: any) => void} onFrame - 帧接收器
 * @returns {Promise<{close: () => void, post: (message: unknown) => void}>} 载体句柄
 */
async function openCarrier(carrierId, request, onFrame) {
  carrierSinks.set(carrierId, onFrame)
  try {
    const outcome = await ipcRenderer.invoke('dsh:transport:stream', { ...request, carrierId })
    if (outcome?.ok !== true) throw new Error(outcome?.error ?? '主进程未建立载体')
  } catch (error) {
    carrierSinks.delete(carrierId)
    throw error
  }
  return {
    post: (message) => ipcRenderer.send('dsh:carrier:post', { carrierId, message }),
    close: () => {
      carrierSinks.delete(carrierId)
      ipcRenderer.send('dsh:carrier:post', { carrierId, message: { kind: 'close', code: 1000, reason: '' } })
    },
  }
}

/**
 * WebSocket 接管。
 *
 * 官方客户端有两条取流路径：`transport.openStream`（外壳自带载具）与自建
 * WebSocket（`new WebSocket(remoteStreamUrl())`）。后者在 `app://` 页面上必然
 * 失败——它的目标地址会退化成 `ws://dsh.internal/...`，既连不上也没有意义，
 * 而且失败是静默的，只表现为「generation 一直不 ready」。
 *
 * 所以这里把 `WebSocket` 本身换成一个走 IPC 的实现：不管客户端选中哪条路径，
 * 物理连接都由主进程持有。这不是绕过官方设计——官方文档明确说自带载具的外壳
 * 应当提供这两个半边；这一层只是保证「漏走另一条路径」时行为依然正确。
 */
function installWebSocketBridge() {
  const NativeWebSocket = globalThis.WebSocket

  /** 只接管官方 Gateway 的流地址；其余（例如 MCP 客户端自连）放行给原生实现。 */
  const isGatewayStreamUrl = (url) => {
    const text = String(url)
    return text.includes('/api/remote.mux') || text.includes('dsh.internal')
  }

  class BridgedWebSocket extends EventTarget {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3

    /** @type {{post: (message: unknown) => void, close: () => void} | undefined} */
    #carrier

    /** 主进程推来的帧 → DOM 事件。 */
    #onFrame = (frame) => {
      if (frame === null || typeof frame !== 'object') return
      if (frame.kind === 'open') {
        this.readyState = 1
        this.dispatchEvent(new Event('open'))
        return
      }
      if (frame.kind === 'message') {
        this.dispatchEvent(new MessageEvent('message', { data: frame.text }))
        return
      }
      if (frame.kind === 'error') {
        this.dispatchEvent(new Event('error'))
        return
      }
      if (frame.kind === 'close') {
        this.readyState = 3
        // 用普通 Event 附加字段，而不是 CloseEvent：后者在各运行时的可用性
        // 不一致，而官方客户端只读 code / reason。
        const closeEvent = new Event('close')
        closeEvent.code = frame.code ?? 1006
        closeEvent.reason = frame.reason ?? ''
        this.dispatchEvent(closeEvent)
      }
    }

    constructor(url) {
      super()
      this.url = String(url)
      this.readyState = 0
      this.#connect()
    }

    #connect() {
      const carrierId = `ws-${String(Date.now())}-${Math.random().toString(36).slice(2)}`
      openCarrier(carrierId, { endpoint: 'websocket-carrier', payload: { url: this.url } }, this.#onFrame)
        .then((handle) => {
          this.#carrier = handle
          console.log(`[dsh-desktop] WebSocket 已接管 ${this.url}`)
        })
        .catch((error) => {
          console.error(`[dsh-desktop] WebSocket 接管失败：${String(error?.message ?? error)}`)
          this.readyState = 3
          this.dispatchEvent(new Event('error'))
          const closeEvent = new Event('close')
          closeEvent.code = 1006
          closeEvent.reason = String(error?.message ?? error)
          this.dispatchEvent(closeEvent)
        })
    }

    send(data) {
      this.#carrier?.post({ kind: 'send', text: typeof data === 'string' ? data : JSON.stringify(data) })
    }

    close(code = 1000, reason = '') {
      if (this.readyState === 3) return
      this.readyState = 2
      this.#carrier?.post({ kind: 'close', code, reason })
    }
  }

  globalThis.WebSocket = new Proxy(NativeWebSocket, {
    construct(target, args) {
      const url = args[0]
      if (isGatewayStreamUrl(url)) return new BridgedWebSocket(url)
      return Reflect.construct(target, args)
    },
  })

  console.log('[dsh-desktop] WebSocket 接管已安装')
}

installWebSocketBridge()

// ── 1.5 引导门面与模块图 ──────────────────────────────────────────────────
//
// 官方把这两样东西放在 index.html 的内联 `<script>` 里，由 webServer 在
// 响应页面时注入。桌面版的页面走自定义协议，内联脚本在该通道下不执行，
// 所以改由 preload 同步取回并在这里装好 —— preload 保证在文档任何脚本之前运行，
// 比内联脚本更早，也更不依赖通道对脚本的执行策略。
//
// 注意顺序：必须先建立门面（queue 模式），官方脚本才有地方注册自己的工厂；
// 而 `__DSH_BOOT__` 必须早于 application batch 被读取。
try {
  const bootstrap = ipcRenderer.sendSync('dsh:bootstrap:sync', { theme: boot.theme })
  if (bootstrap?.ok !== true) throw new Error(bootstrap?.error ?? '引导握手未返回数据')

  // 队列脚本是官方 `bootInjections` 产出的源码，求值即得到官方门面，
  // 不在这里重写协议。
  const installFacade = new Function(`${bootstrap.payload.queueScript}\n//# sourceURL=dsh-boot-facade.js`)
  installFacade()

  globalThis.__DSH_BOOT__ = bootstrap.payload.bootGraph
  // 官方 shell 会等这个 deferred；内联尾脚本在自定义协议下不执行，这里放行。
  globalThis.__DSH_BOOT_READY__ = Promise.withResolvers()
  globalThis.__DSH_BOOT_READY__.resolve()

  // 引导批次（client-modules 自己）也必须由我们装载。
  //
  // 官方把它放在 index.html 的一个 `<script src="/plugins/…">` 里，但桌面版的
  // 页面走自定义协议，那个标签在这里不会被执行。缺了它，`__ModuleLoader__`
  // 的队列里就没有模块系统的实现，shell 调 `create()` 时会直接报
  // "HTML did not preload @deepseek-ai/dsh-client-modules/client.js"。
  //
  // 这里把同一份字节取回来自己执行——走的是官方的 `loadBundle` 载具（IPC），
  // 所以仍然没有任何 HTTP 参与。时序上 preload 早于所有页面脚本，
  // shell 又是 module script（更晚执行），队列一定已经就绪。
  const bootstrapBatch = bootstrap.payload.bootGraph?.batches?.find((batch) => batch.phase === 'bootstrap')
  if (bootstrapBatch !== undefined) {
    void transportLoadBundle(bootstrapBatch.url).then(
      () => console.log('[dsh-desktop] 引导批次已装载（client-modules）'),
      (error) => console.error('[dsh-desktop] 引导批次装载失败：', error),
    )
  }

  console.log(
    `[dsh-desktop] 引导已注入：facade=${globalThis.__ModuleLoader__ === undefined ? '缺失' : globalThis.__ModuleLoader__.mode}` +
      ` graph=${String(bootstrap.payload.bootGraph?.entries?.length ?? 0)} entries`,
  )
} catch (error) {
  console.error('[dsh-desktop] 引导注入失败：', error)
}

// ── 2. 桌面层接口 ──────────────────────────────────────────────────────────

/** 等待渲染进程 DOM 就绪。 */
function whenDomReady() {
  if (document.readyState !== 'loading') return Promise.resolve()
  return new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
}

/** 把主进程的命令广播转发给桌面层监听者。 */
const commandListeners = new Set()
ipcRenderer.on('dsh:command', (_event, command) => {
  for (const listener of commandListeners) {
    try {
      listener(command)
    } catch (error) {
      console.error('[desktop] command listener threw:', error)
    }
  }
})

/** 把主进程的窗口状态广播转发给桌面层监听者。 */
const windowStateListeners = new Set()
const currentWindowState = { maximized: false, fullscreen: false, focused: true }
ipcRenderer.on('dsh:window:state', (_event, state) => {
  Object.assign(currentWindowState, state)
  for (const listener of windowStateListeners) listener({ ...currentWindowState })
})

/** 更新状态广播。 */
const updateStateListeners = new Set()
ipcRenderer.on('dsh:update:state', (_event, state) => {
  for (const listener of updateStateListeners) listener(state)
})

/**
 * 暴露给页面的桌面 API。
 *
 * 刻意保持窄：只有窗口控制、设置读写、原生对话框、通知、外链。
 * 渲染进程拿不到 ipcRenderer 本身，也就无法调用未列出的通道。
 */
const desktopApi = {
  boot: Object.freeze({ ...boot }),

  window: {
    minimize: () => ipcRenderer.invoke('dsh:window:action', 'minimize'),
    maximize: () => ipcRenderer.invoke('dsh:window:action', 'maximize'),
    close: () => ipcRenderer.invoke('dsh:window:action', 'close'),
    toggleFullscreen: () => ipcRenderer.invoke('dsh:window:action', 'toggle-fullscreen'),
    getState: () => ipcRenderer.invoke('dsh:window:state'),
    onState: (listener) => {
      windowStateListeners.add(listener)
      return () => windowStateListeners.delete(listener)
    },
    /** 当前窗口状态快照（同步读，供首次渲染用）。 */
    state: () => ({ ...currentWindowState }),
  },

  store: {
    get: (key, fallback) => ipcRenderer.invoke('dsh:store:get', key, fallback),
    set: (key, value) => ipcRenderer.invoke('dsh:store:set', key, value),
    all: () => ipcRenderer.invoke('dsh:store:all'),
  },

  app: {
    info: () => ipcRenderer.invoke('dsh:app:info'),
    openPath: (path) => ipcRenderer.invoke('dsh:app:open-path', path),
    reveal: (path) => ipcRenderer.invoke('dsh:app:reveal', path),
    openExternal: (url) => ipcRenderer.invoke('dsh:app:open-external', url),
    openDataDir: () => ipcRenderer.invoke('dsh:app:reveal-userdata'),
  },

  update: {
    getState: () => ipcRenderer.invoke('dsh:update:state'),
    check: () => ipcRenderer.invoke('dsh:update:check'),
    download: () => ipcRenderer.invoke('dsh:update:download'),
    install: () => ipcRenderer.invoke('dsh:update:install'),
    setChannel: (channel) => ipcRenderer.invoke('dsh:update:channel', channel),
    onState: (listener) => {
      updateStateListeners.add(listener)
      return () => updateStateListeners.delete(listener)
    },
  },

  dialog: {
    open: (options) => ipcRenderer.invoke('dsh:dialog:open', options),
  },

  notify: (title, body) => ipcRenderer.invoke('dsh:notify', { title, body }),

  /** 订阅主进程菜单命令。 */
  onCommand: (listener) => {
    commandListeners.add(listener)
    return () => commandListeners.delete(listener)
  },

  /** 读取主进程持有的资源文本（主题 CSS、桌面层脚本）。 */
  readResource: (path) => ipcRenderer.invoke('dsh:transport:resource', path),

  /**
   * 让窗口底色跟上当前主题，避免缩放/最大化时闪出旧色。
   * @param {string} color - CSS 颜色
   */
  setBackgroundColor: (color) => {
    if (typeof color === 'string' && color !== '') {
      ipcRenderer.send('dsh:window:background', color)
    }
  },

  /** 把一段 CSS 注入文档，返回移除函数。 */
  injectStyle: (css, id) => {
    const element = document.createElement('style')
    if (id !== undefined && id !== '') element.setAttribute('data-dsh-desktop', id)
    element.textContent = css
    document.head.append(element)
    return () => element.remove()
  },

  whenDomReady,
}

// 直接挂在共享全局上：关闭上下文隔离后，preload 与页面是同一个世界，
// 页面的桌面层脚本会读 `window.dshDesktop`。
globalThis.dshDesktop = desktopApi

// ── 3. 装载桌面层 ──────────────────────────────────────────────────────────
//
// 桌面层（窗口边框、桌面交互）本身就是一个普通的客户端插件包。
// 它在官方模块系统进入 live 模式之后、DOM 就绪之前注册自己的工厂，
// 这样它的模块体会在首次 import 时执行 —— 与官方 UI 插件完全同一条路径。
//
// 注意这里用的是官方那个「HTML 预装的注册门面」：`__ModuleLoader__` 起初处于
// queue 模式并暴露 `load()`。等 shell 调 `create()` 时才把它切成 live。
async function registerDesktopShell() {
  const source = await ipcRenderer.invoke('dsh:transport:resource', desktopShellPath)
  if (typeof source !== 'string' || source === '') return
  // 直接在页面的主世界里求值：桌面层需要与官方模块系统共享同一个全局。
  // eslint-disable-next-line no-new-func
  const run = new Function(`${source}\n//# sourceURL=dsh-desktop-shell.js`)
  run()
}

/** 桌面层脚本的绝对路径，由主进程在窗口创建时告知。 */
const desktopShellPath = boot.desktopShellPath

whenDomReady().then(
  async () => {
    // 等 React 把界面挂上去，再注入桌面层：否则标题栏要么被覆盖，
    // 要么与 React 的挂载点抢位置。
    await waitForAppMount()

    await registerDesktopShell().catch((error) => {
      console.error('[desktop] 桌面层装载失败：', error)
    })
  },
  (error) => console.error('[desktop] DOM 就绪等待失败：', error),
)
