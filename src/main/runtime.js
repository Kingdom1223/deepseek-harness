/**
 * DSH 运行时宿主。
 *
 * 这里做的是「把 `dsh --profile desktop` 这个进程内嵌进 Electron 主进程」：
 * 不 spawn CLI、不开终端窗口、不监听公网、不打开浏览器。
 *
 * 组装方式绕开了 apps/cli 的 runProfile，也绕开了 app-boot 的 include 机制，
 * 原因见 `mount.js` 的模块注释。这里负责的是它之外的事情：
 * 解析 profile、压平补丁、组装条目、把 web 层的 inject 依赖补齐、以及
 * 在服务就位后交出 webServer / connection / clientModules 三个句柄。
 */
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import {
  loadLayeredEnv,
  loadOptionalPatches,
  loadProfileDirectory,
  readProfileManifest,
} from '@deepseek-ai/dsh-app-boot'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describeTree, mountTree } from './mount.js'
import { createDesktopDirectoryPicker } from './directory-picker.js'
import { installElectronNodeRunnerBridge } from './electron-node-runner.js'
import { installAsarExecutableBridge } from './asar-executable.js'
import { bareModuleBase, installAnchor, profileDir, profileRootConfigPath } from './paths.js'

/** 诊断与 Cordis 树名。 */
const NAME = 'dsh-desktop'

/** 想确认就位的服务，用于失败报告。 */
const WATCHED_SERVICES = ['loader', 'webServer', 'webRuntime', 'connection', 'clientModules']

/**
 * 一个延迟对象，用于把「DSH 树已稳定」这个事实交给窗口创建流程。
 * @returns {{promise: Promise<void>, resolve: () => void, reject: (error: unknown) => void}}
 */
function createDeferred() {
  /** @type {() => void} */
  let resolve = () => {}
  /** @type {(error: unknown) => void} */
  let reject = () => {}
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * 启动 DSH 运行时。
 *
 * 返回的 `ctx` 就是 Cordis 根上下文，桌面壳需要的一切都在它上面。
 *
 * @param {{ userArgs?: string[], onExitRequested?: (code: number) => void, pickDirectory?: () => Promise<string | null>, logger?: {info: Function, warn: Function, error: Function} }} [options]
 * @returns {Promise<{ ctx: any, webServer: any, connection: any, clientModules: any, failures: string[], dispose: () => Promise<void> }>}
 */
export async function startRuntime(options = {}) {
  // 必须在 Loader 动态导入 dsh-subprocess-local 之前安装：该包会捕获
  // node:child_process 的 spawn，用它启动 Windows Job runner。
  installElectronNodeRunnerBridge()

  const log = options.logger ?? {
    info: (/** @type {string} */ m) => console.log(`[dsh] ${m}`),
    warn: (/** @type {string} */ m) => console.warn(`[dsh] ${m}`),
    error: (/** @type {string} */ m) => console.error(`[dsh] ${m}`),
  }

  const profile = profileDir()
  readProfileManifest(NAME, profile)

  const loaded = loadProfileDirectory(NAME, profile, installAnchor())
  log.info(`profile ${loaded.dir} 装载 ${String(loaded.layers.length)} 个 bundle 层`)

  // 压平成**一维 patch 列表**：bundle 层（按声明顺序）→ profile 用户层。
  //
  // 两个易错点，都踩过：
  //   1. 必须传未应用的 patch，不能传 composeEntries 的结果（那是已展开的条目表）。
  //   2. 必须传扁平数组。applyEntryPatches 把每个元素当 patch 用，传嵌套数组会让
  //      每一层变成一个无 id 的 patch，被静默跳过，最后得到 0 个条目。
  const profilePatches = loadOptionalPatches(NAME, loaded.patchPath) ?? []
  const patchList = [...loaded.layers.flatMap((layer) => layer.patches), ...profilePatches]

  const entries = applyEntryPatches([], patchList, (message, ...args) => {
    let index = 0
    log.warn(`patch: ${message.replace(/%C/g, () => JSON.stringify(args[index++]))}`)
  })
  log.info(`补丁压出 ${String(entries.length)} 个条目`)

  const ready = createDeferred()

  const { ctx, failures, stalled } = await mountTree({
    Context,
    Loader,
    entries,
    // include 需要这两样：根配置文件路径，以及要应用上去的 patch 列表。
    // patch 必须是**扁平**数组且未应用——composeEntries 的结果是已展开的条目表，
    // 交给 include 会得到一棵空树；嵌套数组会让每层变成一个无 id 的 patch 被跳过。
    configPath: profileRootConfigPath(),
    patches: patchList,
    baseUrl: `${pathToFileURL(dirname(profileRootConfigPath())).href}/`,
    // 根 Include 里的裸包由桌面应用安装拥有。除了从这里导入，还要把同一基准
    // 传进插件上下文；agent-presets 会继续用它解析 standard preset 的动态行。
    bareModuleBaseUrl: `${pathToFileURL(bareModuleBase()).href}/`,
    // 安装锚点：桌面版的 profile 随应用分发，而依赖装在应用自己的
    // `node_modules` 里，两者是兄弟目录。只从 profile 向上找永远找不到
    // （开发态恰好能向上撞到工作区的 node_modules，所以这个差异只在打包后暴露）。
    installAnchors: [installAnchor()],
    log: (message) => log.warn(message),
    prepare: (hostCtx) => {
      // boot() 在挂载 Loader 之前会提供这个：会话持久化、存储、agent preset
      // 扫描等行都靠它把 `~/.dsh` 下的相对路径拼成绝对路径。缺了它这些行会
      // 直接以 "dshHomePath is not defined" 失败。
      hostCtx.provide('dshHomePath', dshHomePath)

      // 桌面载具自己拥有退出权：先关窗口，再优雅释放树。
      hostCtx.provide('appExit', (code = 0) => {
        options.onExitRequested?.(code)
      })
      hostCtx.provide('cmdlineArgs', { get: () => Object.freeze([...(options.userArgs ?? [])]) })

      // 刻意**不**提供 `appReady`。
      //
      // `dsh-web-app` 在 connection 就绪后会读 `ctx.get('loader')?.await()` 来等
      // 整棵树稳定后再打印/打开 URL。宿主一旦提供 appReady，那段代码就会变成
      // 「树里的一行在等整棵树稳定」——自己等自己，loader.await() 永不返回，
      // 表现是进程活着、日志停在挂载中途、窗口永远不出现。
      //
      // 桌面版本来也不需要这个就绪信号：窗口由宿主自己决定何时创建。

      // web bundle 里的 webserver / web-runtime 两行声明了 `inject: [webStartup]`。
      // 在 CLI 路径下这个服务由 `dsh web` 那个 app 命令自己提供；桌面载具是宿主、
      // 没有命令行层，所以必须在这里提供，否则这两行会停在 inject 等待上。
      //
      // 桌面版的取值是固定的：只听回环、端口交给操作系统分配（随机端口），
      // LAN 信任列表为空。配置层面（desktop-profile/cordis.patch.yml）已把这两行
      // 的 config 写成同样的字面量，所以这里提供的是依赖占位，不是配置来源。
      hostCtx.provide('webStartup', {
        host: '127.0.0.1',
        port: 0,
        trustedHosts: [],
      })

      // 官方 Win32 picker 会用 process.execPath 拉起 Node worker；Electron 打包后
      // 它指向桌面 EXE，worker 会提前退出。桌面宿主直接提供系统目录对话框能力。
      // 无窗口自检没有真实对话框，以“用户取消”作为无副作用实现；正式桌面入口
      // 总会传入 Electron dialog 回调。这样控制器在两种宿主中都能完成挂载。
      hostCtx.provide(
        'directoryPicker',
        createDesktopDirectoryPicker(options.pickDirectory ?? (async () => null)),
      )
    },
  })

  /** @type {any} */
  const webServer = ctx.get('webServer')
  /** @type {any} */
  const connection = ctx.get('connection')
  /** @type {any} */
  const clientModules = ctx.get('clientModules')

  // 原生工具在 app.asar.unpacked，模块解析却会返回 app.asar 虚拟路径。
  // 在所有工具共享的 subprocess 边界统一落到真实文件，glob/grep 的 rg.exe
  // 以及以后新增的原生 CLI 都走同一条兼容路径。
  installAsarExecutableBridge(ctx.get('subprocess'))

  if (webServer === undefined) {
    throw new Error(
      `dsh-desktop: webServer 服务未挂载，desktop profile 组合不完整\n` +
        describeTree(ctx, WATCHED_SERVICES) +
        (failures.length === 0 ? '' : `\n  未激活条目：\n${failures.map((f) => `    - ${f}`).join('\n')}`) +
        ((stalled ?? []).length === 0 ? '' : `\n  卡住的条目：\n${stalled.map((f) => `    - ${f}`).join('\n')}`),
    )
  }

  log.info(`API 载体绑定 ${String(webServer.host)}:${String(webServer.port)}（仅回环，随机端口）`)

  // 客户端模块图是界面能否起来的前提：它是官方 shell 装载 39 个 UI 插件的清单。
  // 一旦这里是空的，界面会以「HTML did not preload client-modules」告终，
  // 所以把扫描器的视角直接报出来，而不是等到渲染进程报错才发现。
  if (clientModules !== undefined) {
    const graph = clientModules.graph()
    if (graph.entries.length === 0) {
      const loader = ctx.get('loader')
      const rows = [...(loader?.entries?.() ?? [])]
      const names = rows.map((entry) => entry.options?.name).filter((name) => typeof name === 'string')
      log.warn(
        `客户端模块图为空（loader 里 ${String(names.length)} 行）。` +
          `dsh-client-* 行数=${String(names.filter((name) => name.includes('dsh-client-')).length)}；` +
          `loader.internal=${String(loader?.internal === undefined ? '缺失' : (loader.internal.version ?? '无版本'))}`,
      )
    } else {
      log.info(`客户端模块图：${String(graph.entries.length)} 个条目、${String(graph.batches.length)} 个批次`)
    }
  }

  ready.resolve()

  return {
    ctx,
    webServer,
    connection,
    clientModules,
    failures,
    stalled,
    env: loadLayeredEnv(NAME, profile),
    dispose: async () => {
      await ctx.fiber.dispose()
    },
  }
}

export { createDeferred, describeTree }
