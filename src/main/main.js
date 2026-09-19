/**
 * 应用入口：把 DSH 运行时、窗口、原生能力编排成一个桌面应用。
 *
 * 启动序列刻意分成三段，每段失败都能给出可读的诊断，而不是一个白窗口：
 *
 *   1. 起运行时   —— 进程内挂载 Cordis 树，拿到 webServer / connection / clientModules
 *   2. 建窗口     —— 从 file:// 装载官方前端产物，装载前由 preload 注入 IPC 载具
 *   3. 挂原生面   —— 菜单、托盘、快捷键、窗口控件
 *
 * 没有任何一步会把用户带到浏览器，也没有任何一步依赖一个公网或局域网可达的端口。
 */
import { app, BrowserWindow, dialog, ipcMain, net, Notification, session, shell } from 'electron'
import { appendFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import { APP_ROOT, frontendDistDir, frontendIndex } from './paths.js'
import { installPageProtocol, ORIGIN, registerScheme } from './page-protocol.js'
import { startRuntime } from './runtime.js'
import { DesktopTransport } from './transport.js'
import { installApplicationMenu, installTray } from './native.js'
import { attachWindowControls } from './window-controls.js'
import { DesktopStore } from './store.js'
import { runElectronSmokeChecks } from './smoke-checks.js'
import { createElectronUpdateService } from './electron-updates.js'

/** 开发态判定：`--dev` 或在非打包环境直接跑 electron . */
const isDev = process.argv.includes('--dev') || !app.isPackaged
/** 无窗口的发布包自检；供升级和安装流水线调用。 */
const isSmokeTest = process.argv.includes('--smoke-test')
/**
 * 冒烟检查必须与真实用户目录、单实例锁完全隔离。外层测试启动器会在进程完全
 * 退出、Chromium 释放文件句柄后清理；直接调用时则在系统临时目录创建独立目录。
 */
const smokePrefix = join(tmpdir(), 'dsh-desktop-smoke-')
const suppliedSmokeData = process.env.DSH_SMOKE_USER_DATA
const smokeUserData = isSmokeTest
  ? suppliedSmokeData?.startsWith(smokePrefix) === true ? suppliedSmokeData : mkdtempSync(smokePrefix)
  : undefined
if (smokeUserData !== undefined) app.setPath('userData', smokeUserData)

// 桌面版不发遥测。profile 层已经把那一行禁用了，这里再加一道环境开关：
// 两道一起才叫"关掉"，只设环境变量的那种开关太容易被别处覆盖。
process.env.DSH_TELEMETRY_DISABLED ??= '1'

/** 单实例：第二次启动只是把已有窗口带到前台。 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// 必须在 ready 之前登记自定义协议的权限：晚一步 registerSchemesAsPrivileged
// 就会失效，页面来源会退化成不安全的 opaque origin。
registerScheme()

/** 运行时句柄，窗口与 IPC 都读它。 */
let runtime
/** @type {BrowserWindow | undefined} */
let mainWindow
/** @type {DesktopTransport | undefined} */
let transport
/** @type {DesktopStore | undefined} */
let store
/** @type {import('./update-service.js').UpdateService | undefined} */
let updateService

/** 结构化日志：主进程日志同时进 stdout 与窗口（启动失败时窗口还没起来）。 */
const log = {
  info: (message) => process.stdout.write(`[dsh-desktop] ${message}\n`),
  warn: (message) => process.stderr.write(`[dsh-desktop] ${message}\n`),
  error: (message) => process.stderr.write(`[dsh-desktop] ${message}\n`),
}

/**
 * 启动阶段追踪。
 *
 * stdout 在 Electron 主进程里可能因缓冲而在硬崩时丢失，所以启动阶段同时写一份
 * 到文件。窗口起不来时，这个文件是唯一能说明「卡在哪一步」的东西。
 */
const TRACE_FILE = join(app.getPath('userData'), 'startup.log')
const startedAt = Date.now()
function trace(step) {
  const line = `[${String(Date.now() - startedAt).padStart(6)}ms] ${step}\n`
  process.stdout.write(`[dsh-desktop] ${step}\n`)
  try {
    appendFileSync(TRACE_FILE, line)
  } catch {
    /* 追踪本身绝不能影响启动 */
  }
}

/**
 * 把一个尽力而为的步骤包起来：失败只记录，不阻断启动。
 * @param {string} label - 步骤名
 * @param {() => Promise<unknown> | unknown} run - 步骤体
 */
async function step(label, run) {
  try {
    await run()
  } catch (error) {
    log.warn(`${label} 失败（不影响启动）：${error instanceof Error ? error.message : String(error)}`)
  }
}

// Electron 的默认安全姿态：渲染进程无 Node、有上下文隔离、沙箱开启。
// 页面通过 preload 暴露的窄接口访问原生能力。
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    // 外链一律交给系统浏览器，绝不在应用内开新窗口。
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    // 只允许停在应用自己的页面内。
    if (url.startsWith('file://')) return
    event.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
  })
})

/** 让 file:// 页面能读到自己的资源，同时禁止任何网络出口。 */
function lockDownSession() {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'clipboard-read' || permission === 'clipboard-sanitized-write')
  })
  // 渲染进程没有任何自己的网络出口：它的全部请求都走 IPC。
  // 所以这里对一切非 file:// 的请求直接拒绝——包括 localhost。
  // 这既是安全边界，也是「这不是一个网页」的架构保证。
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    log.warn(`拦截渲染进程的网络请求（桌面版一律走 IPC）：${details.url}`)
    callback({ cancel: true })
  })
}

/**
 * 创建主窗口。
 * @returns {BrowserWindow} 主窗口
 */
function createWindow() {
  const window = new BrowserWindow({
    width: Number(store.get('window.width', 1440)),
    height: Number(store.get('window.height', 920)),
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: store.get('appearance.backgroundColor', '#0b0d12'),
    // 无边框 + 自绘标题栏：桌面版自己的窗口外观，而不是系统标题栏。
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(APP_ROOT, 'src', 'preload', 'preload.js'),
      // 关闭上下文隔离是**必须**的，不是图省事。
      //
      // 官方为「自带物理载具的外壳」预留的接缝是 `globalThis.__DSH_TRANSPORT__`：
      // 客户端连接插件在页面主世界里读它，用来替换 fetch / 事件流 / 插件包加载。
      // preload 若跑在隔离世界里，它设的全局变量页面读不到，接缝静默失效——
      // 症状就是 shell 报 "bootstrap facade is missing"，界面永远出不来。
      //
      // 代价由设计补回来：页面源码全部来自本机、由主进程的 app:// 通道逐字节
      // 供给；渲染进程没有网络出口（见 lockDownSession）；没有开启 nodeIntegration，
      // 页面拿不到 require/process；需要原生的能力一律经 contextBridge 暴露的
      // 窄接口 dshDesktop 转发。
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
      // 关键：把「页面自己的源」和「API 载体的源」分开是没意义的——
      // 页面来自 file://，它的所有请求都经 IPC，所以这里不需要放开网络权限。
      webSecurity: true,
      additionalArguments: [`--dsh-desktop-preload=${encodeURIComponent(JSON.stringify({
        platform: process.platform,
        version: app.getVersion(),
        desktopShellPath: join(APP_ROOT, 'src', 'desktop', 'desktop-shell.js'),
      }))}`],
    },
  })

  attachWindowControls(window, store)

  window.once('ready-to-show', () => {
    trace('窗口 ready-to-show，显示')
    window.show()
  })
  window.webContents.on('did-finish-load', () => trace('渲染进程 did-finish-load'))
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    trace(`渲染进程装载失败 code=${String(code)} ${description} ${url}`)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    trace(`渲染进程退出：${JSON.stringify(details)}`)
  })
  // 新版 Electron 把参数放在事件对象上，旧版是位置参数——两种都兼容。
  window.webContents.on('console-message', (...args) => {
    const first = args[0]
    const level = typeof first === 'object' && first !== null && 'level' in first ? first.level : args[1]
    const message = typeof first === 'object' && first !== null && 'message' in first ? first.message : args[2]
    const line = typeof first === 'object' && first !== null && 'lineNumber' in first ? first.lineNumber : args[3]
    const source = typeof first === 'object' && first !== null && 'sourceId' in first ? first.sourceId : args[4]
    trace(`[renderer:${String(level)}] ${String(message)} (${String(source)}:${String(line)})`)
  })

  const target = `${ORIGIN}/`
  trace(`装载前端 ${target}（dist ${frontendDistDir()}）`)
  void window.loadURL(target).catch((error) => trace(`loadURL 失败：${String(error)}`))

  window.on('closed', () => {
    mainWindow = undefined
  })

  return window
}

/**
 * IPC 处理器：渲染进程唯一的对外通道。
 * @param {BrowserWindow} window - 主窗口
 */
function installIpc(window) {
  ipcMain.handle('dsh:transport:fetch', async (_event, request) => {
    try {
      return await transport.fetch(request)
    } catch (error) {
      // 「reply was never sent」这种报错不带原因，所以在这里把真实错误
      // 记进追踪文件——它是 RPC 侧唯一的诊断线索。
      trace(`RPC 失败 ${String(request?.url)}：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
      throw error
    }
  })
  // 同步：preload 必须在文档任何脚本之前拿到门面与模块图。
  ipcMain.on('dsh:bootstrap:sync', (event, preferences) => {
    try {
      event.returnValue = { ok: true, payload: transport.bootstrapPayload(preferences ?? {}) }
    } catch (error) {
      event.returnValue = { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('dsh:transport:bundle', async (_event, url) => transport.loadBundle(url))
  ipcMain.handle('dsh:transport:resource', async (_event, path) => transport.readResource(path))
  ipcMain.handle('dsh:transport:origin', async () => transport.origin)
  ipcMain.handle('dsh:transport:session', async () => transport.ensureSession())
  // 事件流载体：主进程持有物理 WebSocket，帧经普通 IPC 通道双向搬运。
  //
  // 刻意不用 MessagePort：主进程建的端口回传到渲染进程这条路在本宿主里不通
  // （端口收不到，且不报错，只表现为流永远没有数据）。两条普通 IPC 通道都已
  // 验证可用，行为可预期。
  ipcMain.handle('dsh:transport:stream', async (event, request) => {
    const carrierId = request?.carrierId
    if (typeof carrierId !== 'string' || carrierId === '') return { ok: false, error: '缺少 carrierId' }
    try {
      // 不 await：这条载体活到流结束，await 会让 invoke 永远不返回，
      // 调用方就拿不到建立成功的确认。
      void transport
        .openStream(request, {
          post: (frame) => {
            if (!event.sender.isDestroyed()) event.sender.send('dsh:carrier:frame', { carrierId, frame })
          },
        })
        .catch((error) => {
          trace(`事件流桥接失败：${error instanceof Error ? error.message : String(error)}`)
        })
      return { ok: true }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      trace(`事件流载体建立失败：${detail}`)
      return { ok: false, error: detail }
    }
  })

  // 渲染进程 → 主进程：该载体要发出的帧（open / cancel / close）。
  ipcMain.on('dsh:carrier:post', (_event, payload) => {
    transport.deliverToCarrier(payload?.carrierId, payload?.message)
  })

  // 主题换色时同步窗口底色，避免缩放/最大化闪出旧色。
  ipcMain.on('dsh:window:background', (event, color) => {
    if (typeof color !== 'string' || color === '') return
    const target = BrowserWindow.fromWebContents(event.sender)
    target?.setBackgroundColor(color)
  })

  ipcMain.handle('dsh:store:get', async (_event, key, fallback) => store.get(key, fallback))
  ipcMain.handle('dsh:store:set', async (_event, key, value) => store.set(key, value))
  ipcMain.handle('dsh:store:all', async () => store.all())

  ipcMain.handle('dsh:window:action', async (_event, action) => {
    const target = BrowserWindow.fromWebContents(_event.sender)
    if (target === undefined || target === null) return
    switch (action) {
      case 'minimize': return target.minimize()
      case 'maximize': return target.isMaximized() ? target.unmaximize() : target.maximize()
      case 'close': return target.close()
      case 'toggle-fullscreen': return target.setFullScreen(!target.isFullScreen())
      default: return undefined
    }
  })
  ipcMain.handle('dsh:window:state', async (_event) => {
    const target = BrowserWindow.fromWebContents(_event.sender)
    return {
      maximized: target?.isMaximized() ?? false,
      fullscreen: target?.isFullScreen() ?? false,
      focused: target?.isFocused() ?? false,
    }
  })
  ipcMain.handle('dsh:app:info', async () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    dshHome: process.env.DSH_HOME ?? '',
    dataDir: app.getPath('userData'),
    dev: isDev,
  }))
  ipcMain.handle('dsh:app:reveal-userdata', async () => shell.openPath(app.getPath('userData')))
  ipcMain.handle('dsh:app:open-path', async (_event, path) => shell.openPath(path))
  ipcMain.handle('dsh:app:reveal', async (_event, path) => shell.showItemInFolder(path))
  ipcMain.handle('dsh:app:open-external', async (_event, url) => {
    if (typeof url !== 'string') return
    if (url.startsWith('http://') || url.startsWith('https://')) await shell.openExternal(url)
  })

  ipcMain.handle('dsh:update:state', async () => updateService?.getState())
  ipcMain.handle('dsh:update:check', async () => updateService?.check())
  ipcMain.handle('dsh:update:download', async () => updateService?.download())
  ipcMain.handle('dsh:update:install', async () => updateService?.install())
  ipcMain.handle('dsh:update:channel', async (_event, channel) => {
    const normalized = channel === 'beta' ? 'beta' : 'stable'
    await store.set('updates.channel', normalized)
    return updateService?.setChannel(normalized)
  })

  ipcMain.handle('dsh:dialog:open', async (_event, options) => {
    const result = await dialog.showOpenDialog(window, {
      title: options?.title ?? '选择',
      defaultPath: options?.defaultPath,
      properties: options?.properties ?? ['openDirectory'],
    })
    return result.canceled ? undefined : result.filePaths
  })
  ipcMain.handle('dsh:notify', async (_event, payload) => {
    if (!Notification.isSupported()) return false
    new Notification({ title: payload?.title ?? 'DeepSeek Harness', body: payload?.body ?? '' }).show()
    return true
  })
}

/**
 * 主流程。
 */
async function bootstrap() {
  trace('bootstrap 开始')
  store = new DesktopStore(join(app.getPath('userData'), 'desktop-settings.json'))
  await store.load()
  trace('桌面设置已加载')

  updateService = await createElectronUpdateService({
    app,
    logger: log,
    channel: store.get('updates.channel', 'stable'),
    beforeInstall: async () => {
      if (runtime === undefined) return
      const active = runtime
      runtime = undefined
      await active.dispose()
    },
  })
  updateService.on('state', (state) => {
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dsh:update:state', state)
    }
  })
  trace(`更新服务已装载：${updateService.getState().supported ? 'GitHub Releases' : updateService.getState().reason}`)

  log.info('启动 DSH 运行时…')
  runtime = await startRuntime({
    userArgs: [],
    pickDirectory: isSmokeTest ? async () => null : async () => {
      const options = {
        title: '选择工作空间',
        buttonLabel: '选择文件夹',
        properties: ['openDirectory', 'createDirectory'],
      }
      const result = mainWindow === undefined
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(mainWindow, options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    // 同样接进 trace：运行时的装配日志是「界面为什么没起来」的第一手线索，
    // 走 stdout 在 Start-Process 启动时等于丢失。
    logger: {
      info: (message) => trace(message),
      warn: (message) => trace(`! ${message}`),
      error: (message) => trace(`!! ${message}`),
    },
    onExitRequested: () => {
      if (mainWindow === undefined) app.quit()
      else mainWindow.close()
    },
  })
  trace(`DSH 运行时就绪，API 载体 127.0.0.1:${String(runtime.webServer.port)}`)

  transport = new DesktopTransport({
    getWebServer: () => runtime.ctx.get('webServer'),
    getConnection: () => runtime.ctx.get('connection'),
    getClientModules: () => runtime.ctx.get('clientModules'),
    // 接进 trace 而不是 stdout：用 Start-Process 启动 Electron 时 stdout/stderr
    // 会被丢弃，走 stdout 的日志等于不存在——这一条曾经让我在诊断上原地打转很久。
    // 只留 warn 及以上：debug/info 级的逐条 RPC 记录在正常运行时是噪音。
    log: (level, message) => {
      if (level === 'warn' || level === 'error') trace(message)
    },
  })
  trace('载体桥已建立')

  lockDownSession()
  trace('会话策略已装载')

  installPageProtocol({
    distDir: frontendDistDir(),
    distIndex: frontendIndex(),
    getWebServer: () => runtime.ctx.get('webServer'),
    handleHostRequest: (request) => transport.forwardRequest(request),
    trace,
  })
  trace('页面通道 app:// 已安装')

  if (isSmokeTest) {
    trace('开始无窗口底层冒烟检查')
      await runElectronSmokeChecks({
        transport,
        directoryPicker: runtime.ctx.get('directoryPicker'),
        agentPresets: runtime.ctx.get('agentPresets'),
        subprocess: runtime.ctx.get('subprocess'),
        shell: runtime.ctx.get('shell'),
        shellWorkspace: smokeUserData,
        updateService,
        fetchImpl: net.fetch,
      report: trace,
    })
    trace('无窗口底层冒烟检查通过')
    app.quit()
    return
  }

  mainWindow = createWindow()
  trace('主窗口已创建')
  installIpc(mainWindow)
  trace('IPC 已注册')

  updateService.startAutoCheck({
    enabled: store.get('updates.autoCheck', true) === true,
    delayMs: 30_000,
  })

  await step('安装应用菜单', () => installApplicationMenu({
    window: mainWindow,
    store,
    isDev,
    onCheckForUpdates: () => updateService?.check(),
  }))
  await step('安装托盘', () => installTray({ window: mainWindow, store, isDev }))
  trace('原生面已装载，启动完成')
}

app.whenReady().then(
  () =>
    bootstrap().catch((error) => {
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
      log.error(`启动失败：${detail}`)
      // 自动检查只靠退出码与日志报告；正常启动才显示原生错误框。
      if (!isSmokeTest) dialog.showErrorBox('DeepSeek Harness 启动失败', detail)
      app.exit(1)
    }),
  (error) => {
    log.error(`Electron 初始化失败：${String(error)}`)
    app.exit(1)
  },
)

app.on('second-instance', () => {
  if (mainWindow === undefined) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

// 平台惯例：Windows/Linux 关掉所有窗口即退出，macOS 留在 Dock。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWindow === undefined) mainWindow = createWindow()
})

// 退出前优雅释放 Cordis 树（会话落盘、子进程回收都在这一层）。
let disposing = false
app.on('before-quit', (event) => {
  if (disposing || runtime === undefined) return
  disposing = true
  event.preventDefault()
  const timeout = setTimeout(() => app.exit(0), 5000)
  runtime
    .dispose()
    .catch((error) => log.warn(`运行时释放失败：${String(error)}`))
    .finally(() => {
      updateService?.dispose()
      clearTimeout(timeout)
      app.exit(0)
    })
})

export { isDev, isSmokeTest }
