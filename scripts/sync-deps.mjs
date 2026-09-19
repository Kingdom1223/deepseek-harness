/**
 * 把 DSH 声明的全部同系列包同步进本项目的 dependencies。
 *
 * 为什么需要这个脚本：DSH 把它的插件分成 dependencies 与 devDependencies 两部分——
 * 运行时真正用到的宿主包（fs-local、pwsh-local、llm-deepseek…）和大量插件包
 * （tool-pwsh、tool-bash、attachment-local、credentials-local、settings-file…）
 * 分开声明。用 `npm i @deepseek-ai/dsh` 只会装到前一半，于是 desktop profile
 * 会在挂载时报告一批 "Cannot find package" —— 功能静默缺失。
 *
 * 这个脚本把 dsh 两个字段里所有 `@deepseek-ai/dsh-*` 包对齐到同一版本，
 * 写进 package.json 的 dependencies，然后由 npm 安装。它保证「装的东西」
 * 与「profile 会挂载的东西」是同一个集合。
 *
 * 用法：node scripts/sync-deps.mjs [--check]
 */
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const DSH_MANIFEST = join(ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')

const checkOnly = process.argv.includes('--check')

const dsh = JSON.parse(await readFile(DSH_MANIFEST, 'utf8'))
const declared = { ...(dsh.dependencies ?? {}), ...(dsh.devDependencies ?? {}) }

/**
 * 未发布到 npm 的包：DSH 在仓库内用 workspace 引用它们做测试与实验特性，
 * 所以它们出现在 package.json 里但 registry 上没有。
 * 尝试安装会直接 404，因此在这里显式排除。
 */
const UNPUBLISHED = [
  'experimental', // 实验特性：agent-team / code-runtime-python
  'testkit', // 测试工具
  'mock-server', // 测试替身
  'replay', // 录制回放
  'loader-smoke', // 冒烟测试
]

/** 收集所有同系列包，并统一成精确版本（避免 ^ 区间带来的 rc 漂移）。 */
const wanted = {}
const skipped = []
for (const [name, range] of Object.entries(declared)) {
  if (!name.startsWith('@deepseek-ai/')) continue
  // 只收 dsh 与 cordis 两个系列：它们是 profile 会 import 的对象。
  if (!/^@deepseek-ai\/(dsh-|cordis|cosmokit|schemastery)/.test(name)) continue
  if (UNPUBLISHED.some((marker) => name.includes(marker))) {
    skipped.push(name)
    continue
  }
  // 用 dsh 自身的版本作为 dsh 系列的对齐版本；cordis 系保留其声明区间。
  wanted[name] = name.startsWith('@deepseek-ai/dsh') ? dsh.version : range
}

const missing = Object.keys(wanted).filter((name) => !existsSync(join(ROOT, 'node_modules', name)))
const manifestPath = join(ROOT, 'package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const manifestMismatches = []
const installedMismatches = []

for (const [name, expected] of Object.entries(wanted)) {
  if (manifest.dependencies?.[name] !== expected) {
    manifestMismatches.push(`${name}: package.json=${manifest.dependencies?.[name] ?? '缺失'}, expected=${expected}`)
  }
  if (name.startsWith('@deepseek-ai/dsh') && existsSync(join(ROOT, 'node_modules', name, 'package.json'))) {
    const installed = JSON.parse(await readFile(join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version
    if (installed !== dsh.version) installedMismatches.push(`${name}: installed=${installed}, expected=${dsh.version}`)
  }
}

// Profile 仍可能依赖已从 DSH 根清单移除的兼容包；它们也必须跟随主版本。
for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
  if (!name.startsWith('@deepseek-ai/dsh') || name in wanted) continue
  if (range !== dsh.version) manifestMismatches.push(`${name}: package.json=${range}, expected=${dsh.version}`)
  if (existsSync(join(ROOT, 'node_modules', name, 'package.json'))) {
    const installed = JSON.parse(await readFile(join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version
    if (installed !== dsh.version) installedMismatches.push(`${name}: installed=${installed}, expected=${dsh.version}`)
  }
}

console.log(`DSH ${dsh.version} 声明了 ${String(Object.keys(wanted).length)} 个可安装的同系列包`)
console.log(`跳过 ${String(skipped.length)} 个未发布包：${skipped.join(', ')}`)
console.log(`本工作区缺失 ${String(missing.length)} 个`)
if (missing.length > 0) for (const name of missing) console.log(`  - ${name}`)
console.log(`package.json 版本偏差 ${String(manifestMismatches.length)} 个`)
if (manifestMismatches.length > 0) for (const item of manifestMismatches) console.log(`  - ${item}`)
console.log(`node_modules 版本偏差 ${String(installedMismatches.length)} 个`)
if (installedMismatches.length > 0) for (const item of installedMismatches) console.log(`  - ${item}`)

if (checkOnly) {
  process.exitCode = missing.length + manifestMismatches.length + installedMismatches.length === 0 ? 0 : 1
} else {
  // 先清掉上一轮可能写进去的未发布包，再合并。
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (UNPUBLISHED.some((marker) => name.includes(marker))) delete manifest.dependencies[name]
    // Profile 可能仍引用已不在 dsh 根清单里的兼容包。不能把它们静默删掉，
    // 但必须和本次 DSH 一起升级，否则 npm 会留下 rc.1/rc.2 混装树。
    else if (name.startsWith('@deepseek-ai/dsh')) manifest.dependencies[name] = dsh.version
  }
  manifest.dependencies = { ...manifest.dependencies, ...wanted }
  // 保持键有序，便于人工审查 diff。
  manifest.dependencies = Object.fromEntries(Object.entries(manifest.dependencies).sort(([a], [b]) => a.localeCompare(b)))
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`\n已把 ${String(Object.keys(wanted).length)} 个包写入 package.json 的 dependencies`)
  console.log('接下来运行：npm install')
}
