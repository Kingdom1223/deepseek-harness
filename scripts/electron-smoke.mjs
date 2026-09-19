/**
 * Electron 级底层冒烟检查。
 *
 * 这份脚本不创建窗口，也不复用用户的 data 目录。它在真正的 Electron 主进程中
 * 启动 DSH、安装 app:// 页面协议，并验证静态资源、动态宿主路由、精确 Fetch
 * 路由及 IPC 信封所共用的传输边界。升级 Electron 或 DSH 后先跑它，能尽早发现
 * “文件能打包、运行时却接不上”的兼容性回归。
 */
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { app, net, protocol } from 'electron'

import { installPageProtocol, ORIGIN, registerScheme, SCHEME } from '../src/main/page-protocol.js'
import { frontendDistDir, frontendIndex } from '../src/main/paths.js'
import { startRuntime } from '../src/main/runtime.js'
import { runElectronSmokeChecks } from '../src/main/smoke-checks.js'
import { DesktopTransport } from '../src/main/transport.js'
import { createElectronUpdateService } from '../src/main/electron-updates.js'

registerScheme()

const smokePrefix = join(tmpdir(), 'dsh-desktop-smoke-')
const suppliedUserData = process.env.DSH_SMOKE_USER_DATA
const userData = suppliedUserData?.startsWith(smokePrefix) === true
  ? suppliedUserData
  : mkdtempSync(smokePrefix)
const reportFile = join(tmpdir(), 'dsh-desktop-smoke-last.log')
writeFileSync(reportFile, '', 'utf8')
app.setPath('userData', userData)

/** Electron 的 GUI 子系统在部分 Windows 启动方式下不会转发 stdout，故同时落临时报告。 */
function report(message, error = false) {
  const line = `${message}\n`
  appendFileSync(reportFile, line, 'utf8')
  ;(error ? process.stderr : process.stdout).write(line)
}

report(`start pid=${String(process.pid)} userData=${userData}`)

/** @type {Awaited<ReturnType<typeof startRuntime>> | undefined} */
let runtime
let updateService

async function main() {
  report('wait Electron ready')
  await app.whenReady()
  report('Electron ready')

  runtime = await startRuntime({
    userArgs: [],
    logger: {
      info: (message) => report(`[runtime] ${message}`),
      warn: (message) => report(`[runtime] ${message}`, true),
      error: (message) => report(`[runtime] ${message}`, true),
    },
  })
  updateService = await createElectronUpdateService({ app, logger: { info: report, warn: report, error: report } })

  const transport = new DesktopTransport({
    getWebServer: () => runtime?.ctx.get('webServer'),
    getConnection: () => runtime?.ctx.get('connection'),
    getClientModules: () => runtime?.ctx.get('clientModules'),
    log: (level, message) => {
      if (level === 'warn' || level === 'error') report(`[transport] ${message}`, true)
    },
  })

  installPageProtocol({
    distDir: frontendDistDir(),
    distIndex: frontendIndex(),
    getWebServer: () => runtime?.ctx.get('webServer'),
    handleHostRequest: (request) => transport.forwardRequest(request),
  })

  await runElectronSmokeChecks({
    transport,
    directoryPicker: runtime.ctx.get('directoryPicker'),
    agentPresets: runtime.ctx.get('agentPresets'),
    subprocess: runtime.ctx.get('subprocess'),
    shell: runtime.ctx.get('shell'),
    shellWorkspace: userData,
    updateService,
    fetchImpl: net.fetch,
    report,
  })
}

async function run() {
  let exitCode = 0
  const hardTimeout = setTimeout(() => {
    report('Electron 底层冒烟检查超时（120000ms）。', true)
    app.exit(1)
  }, 120_000)
  try {
    await main()
    report('Electron 底层冒烟检查通过。')
  } catch (error) {
    exitCode = 1
    report(`Electron 底层冒烟检查失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`, true)
  } finally {
    clearTimeout(hardTimeout)
    if (runtime !== undefined) {
      await runtime.dispose().catch((error) => {
        exitCode = 1
        report(`运行时释放失败：${String(error)}`, true)
      })
    }
    updateService?.dispose()
    try {
      protocol.unhandle(SCHEME)
    } catch {
      /* 清理失败不覆盖真正的检查结果。 */
    }
    app.exit(exitCode)
  }
}

// 不能在 Electron 的 ESM 入口顶层 await `app.whenReady()`：应用模块尚未完成求值时
// ready 事件也不会发出，会形成自等待。把生命周期放进普通异步任务即可。
void run()
