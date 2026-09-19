/**
 * 诊断：打印 desktop profile 组合出的条目全貌。
 *
 * 用于回答「某一行到底有没有进树」这类问题——组合是 patch 层叠加出来的，
 * 只看源文件无法判断最终结果。
 *
 * 用法：node scripts/dump-entries.mjs [过滤关键字]
 */
import {
  composeEntries,
  loadOptionalPatches,
  loadProfileDirectory,
} from '@deepseek-ai/dsh-app-boot'
import { installAnchor, profileDir } from '../src/main/paths.js'

const NAME = 'dsh-desktop'
const filter = process.argv[2]

const loaded = loadProfileDirectory(NAME, profileDir(), installAnchor())
const entries = composeEntries([
  ...loaded.layers.map((layer) => layer.patches),
  loadOptionalPatches(NAME, loaded.patchPath) ?? [],
])

/** 递归展开 insert 树。 */
function flatten(node, depth, out) {
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, depth, out)
    return
  }
  if (node === null || typeof node !== 'object') return
  out.push({ depth, row: node })
  if (node.insert !== undefined) flatten(node.insert, depth + 1, out)
}

const flat = []
flatten(entries, 0, flat)

console.log(`组合条目总数（含嵌套）：${flat.length}\n`)
for (const { depth, row } of flat) {
  const name = typeof row.name === 'string' ? row.name : '(无 name)'
  const id = typeof row.id === 'string' ? row.id : '(无 id)'
  const line = `${'  '.repeat(depth)}${id}  →  ${name}`
  if (filter === undefined || line.includes(filter)) {
    console.log(line)
    if (row.disabled === true) console.log(`${'  '.repeat(depth)}    ⚠ disabled: true`)
    if (row.inject !== undefined) console.log(`${'  '.repeat(depth)}    inject: ${JSON.stringify(row.inject)}`)
    if (row.config !== undefined) console.log(`${'  '.repeat(depth)}    config: ${JSON.stringify(row.config)}`)
  }
}
