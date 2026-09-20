/**
 * 生成应用图标。
 *
 * 使用 build/icon.svg 中的 DeepSeek 官方鲸鱼轮廓作为单一真源，渲染出 Windows
 * 需要的多尺寸 PNG。ICO 由 scripts/make-ico.mjs 单独生成。
 *
 * 用法：node scripts/make-icons.mjs
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const OUT = join(process.cwd(), 'build')

/** Windows 需要的尺寸集合。 */
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512]

await mkdir(OUT, { recursive: true })
await mkdir(join(process.cwd(), 'resources', 'icons'), { recursive: true })
const frontendAssets = join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'assets')
const frontendBundle = (await readdir(frontendAssets)).find((name) => /^index-.*\.js$/.test(name))
if (frontendBundle === undefined) throw new Error('找不到 DeepSeek 官方前端 bundle，无法提取 FishLogo')
const frontendSource = await readFile(join(frontendAssets, frontendBundle), 'utf8')
const fishLogo = frontendSource.match(/\{width:23\.16,height:17\.04\},[$\w]+="([^"]+)";function/)
if (fishLogo?.[1] === undefined) throw new Error('DeepSeek 官方 FishLogo 路径格式已变化，请更新图标提取规则')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 23.16 23.16" width="512" height="512">
  <path fill="#4D6BFE" transform="translate(0 3.06)" d="${fishLogo[1]}"/>
</svg>`
await writeFile(join(OUT, 'icon.svg'), svg, 'utf8')

const source = Buffer.from(svg)
for (const size of SIZES) {
  await sharp(source).resize(size, size).png().toFile(join(OUT, `icon-${size}.png`))
}

// 约定名：electron-builder 默认查找 build/icon.png（>=256px）生成各平台图标。
await sharp(source).resize(512, 512).png().toFile(join(OUT, 'icon.png'))
await sharp(source).resize(32, 32).png().toFile(join(process.cwd(), 'resources', 'icons', 'tray.png'))

console.log(`已生成 ${SIZES.length + 2} 个图标文件到 build/ 与 resources/icons/`)
