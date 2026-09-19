/**
 * 诊断：只用官方导出的 applyEntryPatches 验证「patch 层 → 条目表」这一步。
 *
 * 把数据层和挂载层分开：如果这一步能压出全部条目，问题就一定在挂载侧；
 * 反之问题在数据侧。不启动 Electron，纯 Node 跑。
 *
 * 用法：node scripts/diagnose-patches.mjs
 */
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import { composeEntries, loadOptionalPatches, loadProfileDirectory, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { installAnchor, profileDir } from '../src/main/paths.js'

const NAME = 'dsh-desktop'
const loaded = loadProfileDirectory(NAME, profileDir(), installAnchor())

/** 把 loadOverlayPatches 的结果规整成「层数组」。 */
function asLayer(value, label) {
  if (Array.isArray(value)) return value
  console.log(`  ! ${label} 不是数组，而是 ${typeof value}：${JSON.stringify(value).slice(0, 200)}`)
  return [value]
}

const layers = []
for (const layer of loaded.layers) {
  const patches = loadOverlayPatches(NAME, layer.patchPath)
  layers.push(asLayer(patches, `bundle ${layer.packageName}`))
  console.log(`bundle ${layer.packageName}: ${String(Array.isArray(patches) ? patches.length : '?')} 条顶层 patch`)
}
const profilePatches = asLayer(loadOptionalPatches(NAME, loaded.patchPath), 'profile patch')
layers.push(profilePatches)
console.log(`profile 覆盖层: ${String(profilePatches.length)} 条顶层 patch`)

console.log(`\n总层数 ${String(layers.length)}，每层元素数 ${JSON.stringify(layers.map((l) => l.length))}`)

// 这是 include 内部真正执行的那一步。
const applied = applyEntryPatches([], layers, (message, ...args) => {
  let index = 0
  console.log(`  [patch warn] ${message.replace(/%C/g, () => JSON.stringify(args[index++]))}`)
})
console.log(`\napplyEntryPatches([], layers) → ${String(applied.length)} 个顶层条目`)

/** 统计展开后的条目总数。 */
function count(node) {
  if (Array.isArray(node)) return node.reduce((sum, child) => sum + count(child), 0)
  if (node === null || typeof node !== 'object') return 0
  return 1 + (node.insert === undefined ? 0 : count(node.insert))
}
console.log(`展开后条目总数：${String(count(applied))}`)
console.log(`顶层条目 id：${JSON.stringify(applied.map((row) => row?.id ?? '(无)'))}`)

// 对照：官方 composeEntries 的结果
const composed = composeEntries(layers)
console.log(`\ncomposeEntries(layers) → ${String(composed.length)} 个顶层条目，展开后 ${String(count(composed))}`)
console.log(`顶层条目 id：${JSON.stringify(composed.map((row) => row?.id ?? '(无)'))}`)

console.log(`\n两者顶层 id 是否一致：${JSON.stringify(applied.map((r) => r?.id)) === JSON.stringify(composed.map((r) => r?.id))}`)
