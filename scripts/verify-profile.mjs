/**
 * 装配自检：在启动 Electron 之前，先用纯 Node 验证 desktop profile 能被正确组合。
 *
 * 这一步只做「解析」不碰「执行」：确认 bundle 层可解析、补丁层能压成条目表、
 * 关键行（webserver / web-runtime / connection / client-modules）的配置符合桌面载具预期。
 * 它把最容易出错的装配问题从「Electron 黑盒启动失败」里隔离出来。
 *
 * 用法：node scripts/verify-profile.mjs
 */
import { readFileSync } from 'node:fs'
import {
  composeEntries,
  loadOptionalPatches,
  loadProfileDirectory,
  readProfileManifest,
} from '@deepseek-ai/dsh-app-boot'
import { installAnchor, profileDir, frontendIndex, dshAppDir } from '../src/main/paths.js'
const NAME = 'dsh-desktop'
const problems = []

function check(label, condition, detail = '') {
  const ok = Boolean(condition)
  if (!ok) problems.push(`${label}${detail === '' ? '' : ` — ${detail}`}`)
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail === '' ? '' : `  (${detail})`}`)
}

console.log('── 路径 ────────────────────────────────────────────────')
console.log(`  应用根      ${process.cwd()}`)
console.log(`  dsh 安装    ${dshAppDir()}`)
console.log(`  安装锚点    ${installAnchor()}`)
console.log(`  profile     ${profileDir()}`)
console.log(`  前端 dist   ${frontendIndex()}`)

console.log('\n── profile 清单 ────────────────────────────────────────')
const manifest = readProfileManifest(NAME, profileDir())
check('profile 清单可读', manifest !== undefined)
check('声明了 bundle 层', Array.isArray(manifest?.dsh?.profile?.bundles))

console.log('\n── bundle 层解析 ───────────────────────────────────────')
const loaded = loadProfileDirectory(NAME, profileDir(), installAnchor())
for (const layer of loaded.layers) {
  check(`bundle ${layer.packageName}`, layer.patches.length > 0, `${layer.patches.length} 条补丁`)
}
check('profile 覆盖层可读', Array.isArray(loadOptionalPatches(NAME, loaded.patchPath)))

console.log('\n── 条目表组合 ──────────────────────────────────────────')
const entries = composeEntries([...loaded.layers.map((l) => l.patches), loadOptionalPatches(NAME, loaded.patchPath) ?? []])
check('条目表非空', entries.length > 0, `${entries.length} 个条目`)

/**
 * 条目表是一棵由 `insert` 嵌套出来的树，不是一个平表。
 * 递归展开成 id → 行 的映射，才能检查任意深度的行。
 * @param {any} node - 条目或条目数组
 * @param {Map<string, any>} into - 收集目标
 */
function flatten(node, into) {
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, into)
    return
  }
  if (node === null || typeof node !== 'object') return
  if (typeof node.id === 'string') into.set(node.id, node)
  if (node.insert !== undefined) flatten(node.insert, into)
}

const byId = new Map()
flatten(entries, byId)

console.log('\n── 桌面载具关键行 ──────────────────────────────────────')
const webserver = byId.get('webserver')
check('webserver 行存在', webserver !== undefined)
check('webserver 绑定回环', webserver?.config?.host === '127.0.0.1', String(webserver?.config?.host))
check('webserver 使用随机端口', webserver?.config?.port === 0, String(webserver?.config?.port))

const webRuntime = byId.get('web-runtime')
check('web-runtime 行存在', webRuntime !== undefined)
check('不外调浏览器', webRuntime?.config?.openBrowser === false)
check('不打印 URL', webRuntime?.config?.printUrl === false)

check('connection 行存在（API 载体）', byId.has('connection'))
check('modules 行存在（客户端模块图）', byId.has('modules'))
if (byId.get('modules') !== undefined) {
  check('  modules 指向 dsh-client-modules', byId.get('modules').name === '@deepseek-ai/dsh-client-modules')
}
// frontend-static 不是树中的条目：它由 web-runtime 插件在激活时以子插件方式挂载。
check('web-runtime 行存在（承载 frontend-static 挂载）', byId.has('web-runtime'))

const clientRows = [...byId.values()].filter(
  (row) => typeof row.name === 'string' && row.name.startsWith('@deepseek-ai/dsh-client-ui-'),
)
console.log(`  客户端 UI 插件行：${clientRows.length} 个`)
console.log(`  条目总数（含嵌套）：${byId.size} 个`)

console.log('\n── 前端产物 ────────────────────────────────────────────')
const html = readFileSync(frontendIndex(), 'utf8')
const assets = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((m) => m[1])
check('index.html 可读', html.includes('<div id="root">'))
check('引用了 shell 入口', assets.some((a) => a.startsWith('assets/index-')))
console.log(`  引用资源：${assets.join(', ')}`)

console.log('\n════════════════════════════════════════════════════════')
if (problems.length === 0) {
  console.log('装配自检通过：desktop profile 可以被完整组合。')
  process.exitCode = 0
} else {
  console.log(`装配自检失败，${problems.length} 项问题：`)
  for (const p of problems) console.log(`  - ${p}`)
  process.exitCode = 1
}
