/**
 * 诊断：在 Electron 主进程里真正挂载 DSH 树，然后报告每个条目的激活状态与
 * 关键服务是否就位。
 *
 * 「树稳定了」和「服务出现了」是两件不同的事：某一行可能停在 inject 等待上，
 * 树看起来稳定，但服务永远不出现。这个脚本专门照出这种状态。
 *
 * 用法：electron scripts/diagnose-runtime.mjs
 */
import { app } from 'electron'

const t0 = Date.now()
const mark = (label) => process.stdout.write(`[${String(Date.now() - t0).padStart(6)}ms] ${label}\n`)

process.on('uncaughtException', (error) => {
  process.stdout.write(`\n!! uncaughtException: ${error?.stack ?? String(error)}\n`)
  app.exit(9)
})
process.on('unhandledRejection', (reason) => {
  process.stdout.write(`\n!! unhandledRejection: ${reason?.stack ?? String(reason)}\n`)
  app.exit(8)
})
process.on('exit', (code) => process.stdout.write(`\n[exit] code=${String(code)}\n`))

mark('electron ready 前')
app.whenReady().then(async () => {
  mark('electron ready 后')
  const { startRuntime } = await import('../src/main/runtime.js')
  mark('模块导入完成')

  try {
    const runtime = await startRuntime({
      logger: {
        info: (message) => mark(message),
        warn: (message) => mark(`! ${message}`),
        error: (message) => mark(`!! ${message}`),
      },
    })
    mark(`运行时就绪，API 载体 http://${String(runtime.webServer.host)}:${String(runtime.webServer.port)}`)
    mark(`挂载失败条目：${runtime.failures.length === 0 ? '无' : runtime.failures.join(' | ')}`)
    mark(`卡住的条目：${(runtime.stalled ?? []).length === 0 ? '无' : runtime.stalled.join(' | ')}`)
  } catch (error) {
    mark(`启动失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  }

  mark('诊断完成')
  app.exit(0)
})
