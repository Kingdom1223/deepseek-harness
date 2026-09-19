/**
 * 直接解析 asar 头部，检查打包后某个文件是否真的在归档里。
 *
 * asar 头是 Chromium pickle：四个 UInt32LE，最后一个才是 JSON 的精确字节数。
 * 之后是一段 JSON 目录树，文件内容按 offset 排在后面。这个脚本只读目录树，
 * 用来回答「打包后这个文件到底在不在 asar 里」这类问题——
 * 它比在打包版里插日志快得多。
 *
 * 用法：node scripts/inspect-asar.mjs <asar 路径> <路径关键字> [最多条数]
 */
import { open } from 'node:fs/promises'

const [asarPath, needle = '', limitRaw = '20'] = process.argv.slice(2)
if (asarPath === undefined) {
  console.error('用法：node scripts/inspect-asar.mjs <asar 路径> [路径关键字] [最多条数]')
  process.exit(1)
}
const limit = Number(limitRaw)

const handle = await open(asarPath, 'r')
try {
  // 头部：pickle 元数据占 16 字节；第 4 个 UInt32LE 是无填充的 JSON 长度。
  const head = Buffer.alloc(16)
  await handle.read(head, 0, 16, 0)
  const jsonSize = head.readUInt32LE(12)

  const jsonBuffer = Buffer.alloc(jsonSize)
  await handle.read(jsonBuffer, 0, jsonSize, 16)
  const tree = JSON.parse(jsonBuffer.toString('utf8'))

  console.log(`asar: ${asarPath}`)
  console.log(`目录树条目：${String(Object.keys(tree.files ?? {}).length)} 个顶层项`)

  /** 递归收集文件路径。 */
  const files = []
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const full = `${prefix}/${name}`
      if (child.files === undefined) files.push({ path: full, size: child.size ?? 0, offset: child.offset })
      else walk(child, full)
    }
  }
  walk(tree, '')
  console.log(`文件总数：${String(files.length)}`)

  if (needle !== '') {
    const hits = files.filter((file) => file.path.includes(needle))
    console.log(`\n匹配 "${needle}" 的文件：${String(hits.length)} 个`)
    for (const hit of hits.slice(0, limit)) {
      console.log(`  ${hit.path}  (${String(hit.size)} 字节)`)
    }
    if (hits.length > limit) console.log(`  … 另有 ${String(hits.length - limit)} 个`)
  }
} finally {
  await handle.close()
}
