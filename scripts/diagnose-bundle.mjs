/**
 * 诊断：验证客户端包 URL 能否命中 clientModules 的响应表。
 *
 * `bundleResource` 用的是**未解码**的 `pathname + search` 作为键，所以
 * URL 里 `&` 与 `%26` 是两条不同的键，`??` 与 `?%3F` 也是。这类问题只能
 * 用真实 URL 去问真实的表，猜不出来。
 *
 * 用法：electron scripts/diagnose-bundle.mjs
 */
import { app } from 'electron'

app.whenReady().then(async () => {
  const { startRuntime } = await import('../src/main/runtime.js')
  const out = (line) => process.stdout.write(`${line}\n`)

  const runtime = await startRuntime({ logger: { info: () => {}, warn: () => {}, error: out } })
  const clientModules = runtime.ctx.get('clientModules')
  if (clientModules === undefined) {
    out('clientModules 服务缺失')
    app.exit(1)
    return
  }

  const graph = clientModules.graph()
  out(`模块图 rev=${String(graph.rev)}，条目 ${String(graph.entries.length)} 个，批次 ${String(graph.batches.length)} 个`)
  for (const batch of graph.batches) out(`  批次 ${batch.phase}: ${batch.url}`)

  const bootstrap = graph.batches.find((batch) => batch.phase === 'bootstrap')
  const application = graph.batches.find((batch) => batch.phase === 'application')
  const firstEntry = graph.entries[0]

  /** 逐个试候选 URL 形态。 */
  const candidates = [
    ['bootstrap 批次原始 URL', bootstrap?.url],
    ['application 批次原始 URL', application?.url],
    ['单条 combo（官方 buildCombo 形态）', firstEntry?.url],
    ['单包简单路径', firstEntry === undefined ? undefined : `/plugins/${firstEntry.id}/client.js`],
    ['单包简单路径 + rev', firstEntry === undefined ? undefined : `/plugins/${firstEntry.id}/client.js&rev=${firstEntry.rev}`],
  ]

  for (const [label, url] of candidates) {
    if (url === undefined) continue
    const response = clientModules.fetchBundle({ method: 'GET', url })
    let length = '-'
    if (response.ok) {
      try {
        length = String((await response.text()).length)
      } catch {
        length = '?'
      }
    }
    out(`  ${label}: ${String(response.status)}  body=${length}  url=${url.slice(0, 90)}`)
  }

  out('\n── 通过 DesktopTransport.loadBundle 走一遍 ──')
  const { DesktopTransport } = await import('../src/main/transport.js')
  const transport = new DesktopTransport({
    getWebServer: () => runtime.ctx.get('webServer'),
    getConnection: () => runtime.ctx.get('connection'),
    getClientModules: () => clientModules,
    log: () => {},
  })
  for (const [label, url] of candidates.slice(0, 3)) {
    if (url === undefined) continue
    try {
      const result = await transport.loadBundle(`app://shell${url}`)
      out(`  ${label}: ok，${String(result.body.length)} 字节`)
    } catch (error) {
      out(`  ${label}: 失败 ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  app.exit(0)
})
