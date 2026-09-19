/**
 * 路径解析：开发态与打包态的统一入口。
 *
 * 桌面版有三类需要定位的东西：
 *   1. 应用代码（resources/）—— 开发时在工作区，打包后在 process.resourcesPath
 *   2. DSH 安装（node_modules/@deepseek-ai/dsh）—— 决定 profile bundle 的解析锚点
 *   3. 前端 dist（node_modules/@deepseek-ai/dsh-web-frontend/dist）—— 从 file:// 装载
 *
 * 三者都不写死在配置里：配置里的相对路径在打包后必然失效。
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 本文件所在目录（src/main）。 */
const HERE = dirname(fileURLToPath(import.meta.url))

/** 应用根目录：开发态是工作区根，打包态是 app.asar 内根。 */
export const APP_ROOT = resolve(HERE, '..', '..')

/**
 * 资源目录。打包后 electron-builder 会把 `resources/**` 放到 process.resourcesPath，
 * 开发态则直接读工作区里的 resources/。
 * @returns {string} resources 目录的绝对路径
 */
export function resourcesDir() {
  const packaged = process.resourcesPath
  if (packaged !== undefined && existsSync(join(packaged, 'desktop-profile', 'cordis.yml'))) {
    return packaged
  }
  return join(APP_ROOT, 'resources')
}

/** @returns {string} 桌面 profile 目录的绝对路径 */
export function profileDir() {
  return join(resourcesDir(), 'desktop-profile')
}

/** 用于解析依赖的 require（锚在应用根，兼容 asar）。 */
const appRequire = createRequire(join(APP_ROOT, 'package.json'))

/**
 * 解析一个包内文件的绝对路径。
 * @param {string} specifier - 解析目标，如 `@deepseek-ai/dsh/package.json`
 * @returns {string} 绝对文件路径
 */
export function resolveApp(specifier) {
  return appRequire.resolve(specifier)
}

/**
 * DSH 应用包的目录。
 * @returns {string} 例如 `.../node_modules/@deepseek-ai/dsh`
 */
export function dshAppDir() {
  return dirname(resolveApp('@deepseek-ai/dsh/package.json'))
}

/**
 * `boot()` 的安装锚点：dsh 应用包自己的 package.json 绝对路径。
 * profile 的 bundle 层从「安装优先，其次 profile 目录」的顺序解析，
 * 所以这个锚点决定了 in-box bundle 一定取自同一份安装。
 * @returns {string} 绝对路径
 */
export function installAnchor() {
  return resolveApp('@deepseek-ai/dsh/package.json')
}

/**
 * 内置前端 dist 的 index.html（官方 Vite 产物，file:// 直接装载）。
 * @returns {string} 绝对路径
 */
export function frontendIndex() {
  const pkg = resolveApp('@deepseek-ai/dsh-web-frontend/package.json')
  return join(dirname(pkg), 'dist', 'index.html')
}

/**
 * 内置前端 dist 的根目录。
 * @returns {string} 绝对路径
 */
export function frontendDistDir() {
  return dirname(frontendIndex())
}

/**
 * `boot()` 所需的根配置文件路径。
 *
 * 注意这里返回**文件系统路径**而不是 file:// URL：`boot()` 内部的
 * `mountRootInclude` 自己会做 `pathToFileURL` 转换，传 URL 会被当成相对路径拼接
 * （得到 `...\file:\E:\...` 这种畸形路径）。
 * @returns {string} 绝对路径
 */
export function profileRootConfigPath() {
  return join(profileDir(), 'cordis.yml')
}

/**
 * 裸包名解析基准：让 Cordis loader 从应用安装位置 import `@deepseek-ai/*`。
 * 同样是目录路径，不是 URL。
 * @returns {string} 绝对目录路径
 */
export function bareModuleBase() {
  return APP_ROOT
}
