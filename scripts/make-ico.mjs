/**
 * 生成 Windows .ico。
 *
 * NSIS（electron-builder 的安装包编译器）只接受真正的 ICO，不认 PNG。
 * electron-builder 也不会替我们转换。所以这里按 ICO 容器格式自己拼：
 * 一个 6 字节文件头 + 每张图 16 字节目录项 + 图像数据。
 *
 * Vista 之后的 Windows 允许目录项里直接放 PNG 字节（而不是老式的
 * DIB + AND 掩码），所以这里直接用 sharp 渲染出的 PNG，无需位图转换。
 *
 * 用法：node scripts/make-ico.mjs
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const OUT = join(process.cwd(), 'build')

/** ICO 支持的尺寸（含 256，Windows 会用它做「大图标」视图）。 */
const SIZES = [16, 24, 32, 48, 64, 128, 256]

const svg = await import('node:fs/promises').then((fs) => fs.readFile(join(OUT, 'icon.svg'), 'utf8'))

/** 渲染一张 PNG。 */
const renderPng = (size) => sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer()

const images = await Promise.all(SIZES.map(async (size) => ({ size, data: await renderPng(size) })))

// ── 组装 ICO ────────────────────────────────────────────────────────────────
const HEADER_BYTES = 6
const ENTRY_BYTES = 16
const header = Buffer.alloc(HEADER_BYTES)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: 1 = icon
header.writeUInt16LE(images.length, 4)

let offset = HEADER_BYTES + ENTRY_BYTES * images.length
const entries = []
for (const { size, data } of images) {
  const entry = Buffer.alloc(ENTRY_BYTES)
  // 256 在这两个字段里必须写 0 —— 单字节装不下 256。
  entry.writeUInt8(size >= 256 ? 0 : size, 0) // width
  entry.writeUInt8(size >= 256 ? 0 : size, 1) // height
  entry.writeUInt8(0, 2) // 调色板数（PNG 无调色板）
  entry.writeUInt8(0, 3) // reserved
  entry.writeUInt16LE(1, 4) // color planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(data.length, 8) // 图像数据长度
  entry.writeUInt32LE(offset, 12) // 图像数据偏移
  entries.push(entry)
  offset += data.length
}

const ico = Buffer.concat([header, ...entries, ...images.map((image) => image.data)])
await writeFile(join(OUT, 'icon.ico'), ico)

console.log(
  `已生成 build/icon.ico：${String(images.length)} 个尺寸（${SIZES.join('/')}），${String(ico.length)} 字节`,
)
