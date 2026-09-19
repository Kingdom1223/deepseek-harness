/**
 * 应用内部页面通道（`app://`）。
 *
 * 为什么必须有这一层：官方前端的启动协议不是静态 HTML，而是**渲染时注入**的。
 * `index.html` 里只有一个空的 `#root`，真正的引导由 `webServer.renderIndex()`
 * 在每次响应时把注入表渲染进去：
 *
 *   - 一段建立 `window.__ModuleLoader__` 注册门面的内联脚本
 *   - bootstrap 批次的 `<script src>`（client-modules）
 *   - application 批次的 `<link rel="preload">`
 *   - `window.__DSH_BOOT__` 整张模块图
 *   - 主题首屏脚本、boot readiness 尾脚本
 *
 * 所以「用 file:// 直接打开 dist/index.html」是行不通的——页面能渲染，
 * 但 `__ModuleLoader__` 和 `__DSH_BOOT__` 都不存在，shell 会立刻报
 * "bootstrap facade is missing" 并停住。
 *
 * 桌面版的做法是复刻官方的取页路径，但把传输换成自定义协议：
 * 渲染进程请求 `app://shell/`，主进程在这里调用官方的
 * `webServer.renderIndex()` 生成完整页面再返回。这既拿到了官方全部注入，
 * 又完全不经过 HTTP —— 页面来源是 `app://shell`，不是任何 localhost。
 */
import { app, protocol } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'

/** 自定义协议名。 */
export const SCHEME = 'app'

/** 页面来源。所有资源路径都相对它解析。 */
export const ORIGIN = `${SCHEME}://shell`

/** 扩展名 → Content-Type。与官方 frontend-static 的取值保持一致。 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
}

/**
 * 必须在 app ready 之前登记：让 `app://` 成为一个标准、可信的来源。
 *
 * `standard: true` 让它有正常的 origin 语义（相对路径、URL 解析都按标准来），
 * `secure: true` 让它被视为安全上下文，`supportFetchAPI` 让页面里的
 * fetch/XHR 不因来源被判为不安全。
 */
export function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ])
}

/**
 * 安装 `app://` 处理器。
 *
 * @param {object} options
 * @param {string} options.distDir - 官方前端 dist 的绝对目录
 * @param {string} options.distIndex - dist 内 index.html 的绝对路径
 * @param {() => any} options.getWebServer - 取出活动 webServer 服务（用于官方注入）
 * @param {(request: Request) => Promise<Response>} options.handleHostRequest - 宿主动态路由
 * @param {(line: string) => void} [options.trace] - 诊断输出
 */
export function installPageProtocol(options) {
  const { distDir, distIndex, getWebServer, handleHostRequest } = options
  const trace = options.trace ?? (() => {})

  /** 页面本体缓存：只在第一次请求时向官方取一次注入结果。 */
  let pageCache

  /** 生成完整的引导页面：官方注入 + 两处桌面版必需的修正。 */
  const renderPage = async () => {
    if (pageCache !== undefined) return pageCache
    const raw = await readFile(distIndex, 'utf8')
    const webServer = getWebServer()
    if (webServer === undefined) throw new Error('dsh-desktop: webServer 未就绪，无法渲染引导页面')
    const injected = webServer.renderIndex(raw)

    // 修正一：还原 `&amp;rev=`。
    //
    // 官方的 index 注入里，`script-preload` 行的 src 做了 HTML 属性转义
    // （`&` → `&amp;`），而 `script-src` 行也走同一条 `escapeHtmlAttribute`。
    // 在 HTTP 下浏览器解析 URL 时会宽容地把 `&amp;` 当成参数分隔符，所以没人发现；
    // 在自定义协议下 URL 被严格解析，`rev` 于是变成 `amp;rev`，
    // 客户端的 `atRevision()` 会直接拒绝，整张模块图都装载不了。
    // 这里精确还原为裸 `&`：`&amp;rev=` 这个序列只会出现在官方注入的包 URL 里。
    const unescaped = injected.replaceAll('&amp;rev=', '&rev=')

    // 修正二：桌面版有一条自绘标题栏压在顶部。官方 dist 假设视口从 0 开始，
    // 所以在最早期声明这条高度，避免首帧跳动。
    pageCache = unescaped.replace(
      /<head(\s[^>]*)?>/i,
      (open) => `${open}<style>:root{--dshd-titlebar-height:38px}</style>`,
    )
    trace(`引导页面已渲染（注入后 ${String(pageCache.length)} 字节）`)

    // 把渲染结果落盘：引导协议出问题时，这个文件是唯一能看清
    // 「注入顺序到底长什么样」的东西。
    try {
      const dump = join(app.getPath('userData'), 'boot-page.html')
      await writeFile(dump, pageCache, 'utf8')
      trace(`引导页面副本：${dump}`)
    } catch {
      /* 落盘失败不影响启动 */
    }

    return pageCache
  }

  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== 'shell') return new Response('forbidden', { status: 403 })
    const requested = decodeURIComponent(url.pathname)
    trace(`app:// 请求 ${requested}`)

    // 根路径与任何 SPA 路径都返回引导页面（与官方 fallback 语义一致）。
    if (requested === '/' || requested === '/index.html') {
      try {
        return new Response(await renderPage(), {
          status: 200,
          headers: { 'content-type': MIME['.html'] },
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        trace(`引导页面渲染失败：${detail}`)
        return new Response(fallbackPage(detail), {
          status: 500,
          headers: { 'content-type': MIME['.html'] },
        })
      }
    }

    // 其余资源一律从 dist 读，且禁止越出 dist 根。
    const target = resolve(normalize(join(distDir, requested)))
    if (target !== distDir && !target.startsWith(distDir + sep)) {
      return new Response('forbidden', { status: 403 })
    }
    try {
      const body = await readFile(target)
      return new Response(body, {
        status: 200,
        headers: { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' },
      })
    } catch {
      // 客户端模块由 __DSH_TRANSPORT__.loadBundle 装载。保留这一条单一入口，
      // 避免 HTML 里的 preload/script 标签与 preload 门面重复注册同一个 bundle。
      if (requested === '/plugins' || requested.startsWith('/plugins/')) {
        return new Response('not found', { status: 404 })
      }
      // 静态资源未命中后交给 Harness 自己的路由表。这样 /api、文件上传、
      // 会话导出、open-in-app 以及未来新增的宿主端点都自动复用同一条通道。
      try {
        return await handleHostRequest(request)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        trace(`宿主路由失败 ${requested}：${detail}`)
        return new Response('not found', { status: 404 })
      }
    }
  })

  /** 页面渲染不出来时的兜底页：把原因显示出来，而不是留一个白窗口。 */
  function fallbackPage(detail) {
    return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>DeepSeek Harness</title>
<style>
  html,body{height:100%;margin:0;background:#0b0d12;color:#e8ebf2;
    font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
  .wrap{height:100%;display:grid;place-items:center;padding:40px}
  .card{max-width:640px}
  h1{font-size:16px;margin:0 0 12px;font-weight:600}
  pre{background:#161a23;border:1px solid #28303f;border-radius:8px;padding:14px;
    overflow:auto;font-size:12px;color:#f2a5a5;white-space:pre-wrap}
</style></head><body><div class="wrap"><div class="card">
<h1>界面未能装载</h1>
<p>DSH 运行时没有交出引导页面。</p>
<pre>${detail.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</pre>
</div></div></body></html>`
  }
}
