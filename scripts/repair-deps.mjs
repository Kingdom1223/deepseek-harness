/**
 * 从「实际 import 语句」反推并补齐依赖。
 *
 * 为什么需要这个脚本：DSH 的包在运行时 import 一批**没有在 package.json 里声明**
 * 的兄弟包（`dsh-fs-local` 用 `dsh-fs`，`dsh-agent-loop` 用 `dsh-session-persistence`…）。
 * 在 pnpm + hoisted linker 的原始布局里它们恰好都在，所以这个违规被掩盖了；
 * 一旦换成 npm 的树，这些包就会缺失，而症状是运行到一半才报
 * "Cannot find package"——每个都补一遍既慢又容易漏。
 *
 * 这个脚本扫描已安装的 DSH 包的全部源码，取出其中所有 `@deepseek-ai/*` import，
 * 与当前 node_modules 对照，缺什么就装什么（版本对齐到 dsh 自身版本）。
 *
 * 用法：
 *   node scripts/repair-deps.mjs           打印缺口
 *   node scripts/repair-deps.mjs --install  直接补齐
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCOPE_DIR = join(ROOT, 'node_modules', '@deepseek-ai')
const dshVersion = JSON.parse(await readFile(join(SCOPE_DIR, 'dsh', 'package.json'), 'utf8')).version

/** 递归列出目录下的 .js 文件（跳过嵌套 node_modules，避免重复扫描）。 */
async function listSources(dir, out = []) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await listSources(full, out)
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) out.push(full)
  }
  return out
}

/** import / export-from / 动态 import 里出现的裸包名。 */
const IMPORT_PATTERNS = [
  /\bfrom\s*["'](@deepseek-ai\/[a-z0-9._-]+)(?:\/[a-z0-9._/-]+)?["']/gi,
  /\bimport\s*\(\s*["'](@deepseek-ai\/[a-z0-9._-]+)(?:\/[a-z0-9._/-]+)?["']\s*\)/gi,
  /\brequire\s*\(\s*["'](@deepseek-ai\/[a-z0-9._-]+)(?:\/[a-z0-9._/-]+)?["']\s*\)/gi,
]

console.log(`扫描 ${SCOPE_DIR} 下所有 DSH 包源码中的 import …`)

const tracked = new Set()
const sources = await listSources(SCOPE_DIR)
console.log(`共 ${String(sources.length)} 个源文件`)

for (const file of sources) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch {
    continue
  }
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of text.matchAll(pattern)) tracked.add(match[1])
  }
}

/**
 * 不该被安装的例外。
 *
 * 这几个是**客户端种子模块**：它们的代码被编译进 Web shell bundle
 * （`dsh-web-frontend/dist/assets/index-*.js`），客户端插件里的
 * `require('@deepseek-ai/dsh-client-ui-slots')` 是在运行时由模块表回答的，
 * 而不是从磁盘解析。给它们装一份 node_modules 副本没有任何意义，
 * 反而会让「谁是真的」变得含混。
 */
const CLIENT_SEEDS = new Set([
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

const missing = [...tracked]
  .filter((name) => !CLIENT_SEEDS.has(name))
  .filter((name) => !existsSync(join(ROOT, 'node_modules', name)))
  .sort()

const seedsSkipped = [...tracked].filter((name) => CLIENT_SEEDS.has(name))
console.log(`\n被 import 的 @deepseek-ai 包：${String(tracked.size)} 个`)
console.log(`其中客户端种子模块 ${String(seedsSkipped.length)} 个（已排除，由 shell bundle 提供）`)
console.log(`未安装：${String(missing.length)} 个`)
for (const name of missing) {
  // 找出是谁在用它，方便判断重要性。
  const users = []
  for (const file of sources) {
    if (users.length >= 2) break
    try {
      const text = await readFile(file, 'utf8')
      if (new RegExp(`["']${name.replace(/[/@.]/g, '\\$&')}(?:/[^"']*)?["']`).test(text)) {
        users.push(relative(SCOPE_DIR, file).split('\\')[0])
      }
    } catch {
      /* 忽略读取失败 */
    }
  }
  console.log(`  ${name}   ← ${users.join(', ') || '(未定位)'}`)
}

if (missing.length === 0) {
  console.log('\n依赖完整，无需补齐。')
  process.exitCode = 0
} else if (!process.argv.includes('--install')) {
  console.log('\n加 --install 直接补齐。')
  process.exitCode = 1
} else {
  const manifestPath = join(ROOT, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  for (const name of missing) manifest.dependencies[name] = dshVersion
  manifest.dependencies = Object.fromEntries(Object.entries(manifest.dependencies).sort(([a], [b]) => a.localeCompare(b)))
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`\n已把 ${String(missing.length)} 个包写入 package.json（版本对齐到 ${dshVersion}）。`)
  console.log('接下来运行：npm install')
}
