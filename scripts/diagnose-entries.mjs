/**
 * 诊断：逐条挂载 dsh-base 的条目，精确定位第一次硬崩发生在哪一条。
 *
 * 硬崩（整进程消失、连 uncaughtException 都不触发）没有堆栈可看，只能用
 * 「最后成功挂上的是第几条」来定位。每挂一条就 flush 一行输出，
 * 这样进程消失后最后一行就是凶手的前一条。
 *
 * 用法：electron scripts/diagnose-entries.mjs [起始序号]
 */
import { app } from 'electron'
import { appendFileSync } from 'node:fs'

/** 进度写文件：stdout 在硬崩时可能丢缓冲，文件不会。 */
const LOG = 'E:\\deepseak\\notes\\entry-progress.log'
const trace = (line) => {
  process.stdout.write(`${line}\n`)
  try {
    appendFileSync(LOG, `${line}\n`)
  } catch {
    /* 写不进去也不影响诊断 */
  }
}

app.whenReady().then(async () => {
  const { applyEntryPatches } = await import('@deepseek-ai/cordis-plugin-include')
  const { Context } = await import('@deepseek-ai/cordis')
  const { loadOptionalPatches, loadProfileDirectory } = await import('@deepseek-ai/dsh-app-boot')
  const { installAnchor, profileDir } = await import('../src/main/paths.js')
  const Loader = (await import('@deepseek-ai/cordis-plugin-loader')).default

  const loaded = loadProfileDirectory('dsh-desktop', profileDir(), installAnchor())
  const basePatches = loaded.layers[0].patches
  const entries = applyEntryPatches([], basePatches, () => {})

  const start = Number(process.argv[process.argv.length - 1])
  const from = Number.isFinite(start) ? start : 0

  trace(`base 展开出 ${String(entries.length)} 个条目；从第 ${String(from)} 条开始`)

  const ctx = new Context()
  await ctx.plugin(Loader)
  trace('Loader 已挂载')

  for (const [index, entry] of entries.entries()) {
    if (index < from) continue
    const label = `${String(index).padStart(3)} ${String(entry.name)}${entry.id === undefined ? '' : ` (id=${entry.id})`}`
    trace(`→ ${label}`)
    try {
      await ctx.loader.create(entry)
      trace(`  ok`)
    } catch (error) {
      trace(`  抛错：${error?.message?.split('\n')[0] ?? String(error)}`)
    }
  }

  trace('全部条目尝试完毕')
  app.exit(0)
})
