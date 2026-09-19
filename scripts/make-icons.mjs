/**
 * 生成应用图标。
 *
 * 设计：深空底色 + 品牌紫渐变的核心 + 一个「中括号」形，暗示这是编码工具的载体。
 * 用 SVG 作为单一真源，渲染出 Windows 需要的多尺寸 PNG（electron-builder 会
 * 从 256px 那张自动生成 .ico）。
 *
 * 用法：node scripts/make-icons.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const OUT = join(process.cwd(), 'build')

/** 图标单一真源。 */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#141826"/>
      <stop offset="1" stop-color="#0a0c12"/>
    </linearGradient>
    <linearGradient id="core" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8b7cff"/>
      <stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <rect x="1.5" y="1.5" width="509" height="509" rx="111" fill="none" stroke="#ffffff" stroke-opacity=".07" stroke-width="3"/>
  <path d="M196 150 L108 256 L196 362" fill="none" stroke="url(#core)" stroke-width="42"
        stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M316 150 L404 256 L316 362" fill="none" stroke="url(#core)" stroke-width="42"
        stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="256" cy="256" r="27" fill="url(#core)"/>
</svg>`

/** Windows 需要的尺寸集合。 */
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512]

await mkdir(OUT, { recursive: true })
await mkdir(join(process.cwd(), 'resources', 'icons'), { recursive: true })
await writeFile(join(OUT, 'icon.svg'), svg, 'utf8')

const source = Buffer.from(svg)
for (const size of SIZES) {
  await sharp(source).resize(size, size).png().toFile(join(OUT, `icon-${size}.png`))
}

// 约定名：electron-builder 默认查找 build/icon.png（>=256px）生成各平台图标。
await sharp(source).resize(512, 512).png().toFile(join(OUT, 'icon.png'))
// 托盘图标：小尺寸下简化视觉，去掉外描边避免糊成一团。
const traySvg = svg.replace(/<rect x="1.5".*?\/>/, '')
await sharp(Buffer.from(traySvg)).resize(32, 32).png().toFile(join(process.cwd(), 'resources', 'icons', 'tray.png'))

console.log(`已生成 ${SIZES.length + 2} 个图标文件到 build/ 与 resources/icons/`)
