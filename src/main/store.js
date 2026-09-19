/**
 * 桌面设置存储：主进程与渲染进程共享的一份轻量偏好。
 *
 * 刻意不复用 DSH 自己的 settings（那是模型与运行时配置），这里只放
 * 纯桌面外壳的偏好：窗口几何、侧栏宽度、最近使用的命令。
 * 放在 userData 下，卸载应用时随用户数据一起消失。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 默认值：全新安装的第一印象。 */
const DEFAULTS = Object.freeze({
  'appearance.backgroundColor': '#f7f8fa',
  'appearance.density': 'comfortable',
  'appearance.motion': 'full',
  'window.width': 1440,
  'window.height': 920,
  'window.maximized': false,
  'shell.titlebar': 'custom',
  'shell.commandPaletteHintSeen': false,
  'updates.autoCheck': true,
  'updates.channel': 'stable',
})

export class DesktopStore {
  /** @param {string} file - 存储文件的绝对路径 */
  constructor(file) {
    this.file = file
    /** @type {Record<string, unknown>} */
    this.values = { ...DEFAULTS }
    this.pending = undefined
  }

  /** 读盘。缺失或损坏都退回默认值——桌面外壳的偏好永远不该阻断启动。 */
  async load() {
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed !== null && typeof parsed === 'object') this.values = { ...DEFAULTS, ...parsed }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        process.stderr.write(`[dsh-desktop] 桌面设置读取失败，使用默认值：${String(error)}\n`)
      }
    }
    return this.values
  }

  /**
   * 读一个键。
   * @param {string} key - 点分键名
   * @param {unknown} [fallback] - 未设置时的回退值
   * @returns {unknown} 值
   */
  get(key, fallback) {
    const value = this.values[key]
    if (value === undefined) return fallback ?? DEFAULTS[key]
    return value
  }

  /**
   * 写一个键并异步落盘。
   * @param {string} key - 点分键名
   * @param {unknown} value - 值
   * @returns {Promise<void>}
   */
  async set(key, value) {
    this.values[key] = value
    return this.flush()
  }

  /** @returns {Record<string, unknown>} 全量快照 */
  all() {
    return { ...this.values }
  }

  /**
   * 合并式写入（渲染进程一次改多项时避免多次落盘）。
   * @param {Record<string, unknown>} patch - 增量
   * @returns {Promise<void>}
   */
  async merge(patch) {
    Object.assign(this.values, patch)
    return this.flush()
  }

  /** 原子落盘；并发调用共享同一次写入。 */
  async flush() {
    this.pending ??= (async () => {
      const temp = `${this.file}.tmp`
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(temp, JSON.stringify(this.values, null, 2), 'utf8')
      await rename(temp, this.file)
    })()
      .catch((error) => {
        process.stderr.write(`[dsh-desktop] 桌面设置写入失败：${String(error)}\n`)
      })
      .finally(() => {
        this.pending = undefined
      })
    return this.pending
  }
}

export { DEFAULTS }
