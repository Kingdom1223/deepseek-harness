/**
 * 诊断：二分定位崩溃发生在哪一层 bundle。
 *
 * boot() 期间硬崩时连 uncaughtException / exit 处理器都不会触发，所以只能靠
 * 「挂到第几层为止是好的」来收敛范围。
 *
 * 用法：electron scripts/diagnose-layers.mjs
 */
import { app } from 'electron'

const t0 = Date.now()
const mark = (label) => process.stdout.write(`[${String(Date.now() - t0).padStart(6)}ms] ${label}\n`)

for (const signal of ['uncaughtException', 'unhandledRejection']) {
  process.on(signal, (value) => {
    process.stdout.write(`\n!! ${signal}: ${value?.stack ?? String(value)}\n`)
  })
}
process.on('exit', (code) => process.stdout.write(`\n[exit] code=${String(code)}\n`))

app.whenReady().then(async () => {
  const { boot, loadOptionalPatches, loadProfileDirectory } = await import('@deepseek-ai/dsh-app-boot')
  const { installAnchor, profileDir, profileRootConfigPath } = await import('../src/main/paths.js')

  const loaded = loadProfileDirectory('dsh-desktop', profileDir(), installAnchor())
  const basePatches = loaded.layers[0].patches
  const webPatches = loaded.layers[1].patches
  const profilePatches = loadOptionalPatches('dsh-desktop', loaded.patchPath) ?? []

  const scenarios = [
    { label: '第 0 层：仅 dsh-base', patches: basePatches },
    { label: '第 0+1 层：base + web-app', patches: [...basePatches, ...webPatches] },
    { label: '全量：base + web-app + profile 覆盖', patches: [...basePatches, ...webPatches, ...profilePatches] },
  ]

  for (const scenario of scenarios) {
    mark(`开始 ${scenario.label}（${String(scenario.patches.length)} 条 patch）`)
    try {
      const ctx = await boot('dsh-desktop', profileRootConfigPath(), scenario.patches, (hostCtx) => {
        hostCtx.provide('appExit', () => {})
        hostCtx.provide('cmdlineArgs', { get: () => Object.freeze([]) })
      })
      const entries = [...(ctx.get('loader')?.entries?.() ?? [])]
      mark(`  ✓ 挂载成功，条目 ${String(entries.length)} 个，webServer=${ctx.get('webServer') === undefined ? '缺' : '有'}`)
      await ctx.fiber.dispose()
      mark('  已释放，继续下一场景')
    } catch (error) {
      mark(`  ✗ 抛错：${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
    }
  }

  mark('全部场景结束')
  app.exit(0)
})
