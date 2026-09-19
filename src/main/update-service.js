/**
 * 桌面更新能力的稳定边界。
 *
 * UI 与主进程只认识这里的状态和动作，不直接依赖 electron-updater。以后迁移更新
 * 源或增加灰度发布时，可以替换 adapter，而不用改 preload 与桌面界面。
 */
import { EventEmitter } from 'node:events'

const PHASES = new Set([
  'disabled',
  'idle',
  'checking',
  'available',
  'not-available',
  'downloading',
  'downloaded',
  'installing',
  'error',
])

/** @param {unknown} value @returns {string | null} */
function textOrNull(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** @param {unknown} notes @returns {string} */
export function normalizeReleaseNotes(notes) {
  if (typeof notes === 'string') return notes
  if (!Array.isArray(notes)) return ''
  return notes
    .map((item) => typeof item === 'string' ? item : textOrNull(item?.note))
    .filter((item) => item !== null)
    .join('\n\n')
}

/** @param {unknown} error @returns {string} */
export function safeUpdateError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/([?&](?:token|access_token)=)[^&\s]+/giu, '$1[redacted]')
    .replace(/(authorization:\s*(?:bearer|token)\s+)[^\s]+/giu, '$1[redacted]')
    .slice(0, 800)
}

/**
 * @param {unknown} input
 * @returns {{enabled: boolean, owner: string | null, repo: string | null, channel: 'stable' | 'beta', releaseUrl: string | null, reason: string | null}}
 */
export function normalizeUpdateConfig(input) {
  const value = input !== null && typeof input === 'object' ? input : {}
  const owner = textOrNull(value.owner)
  const repo = textOrNull(value.repo)
  const channel = value.channel === 'beta' ? 'beta' : 'stable'
  const validName = (part) => part !== null && /^[A-Za-z0-9_.-]+$/u.test(part)
  const enabled = value.provider === 'github' && validName(owner) && validName(repo)
  return {
    enabled,
    owner,
    repo,
    channel,
    releaseUrl: enabled ? `https://github.com/${owner}/${repo}/releases/latest` : null,
    reason: enabled ? null : '此构建尚未绑定 GitHub Releases 更新源',
  }
}

/**
 * @typedef {{
 *   phase: string,
 *   supported: boolean,
 *   currentVersion: string,
 *   availableVersion: string | null,
 *   progress: number | null,
 *   transferred: number | null,
 *   total: number | null,
 *   bytesPerSecond: number | null,
 *   releaseNotes: string,
 *   releaseUrl: string | null,
 *   channel: 'stable' | 'beta',
 *   error: string | null,
 *   reason: string | null,
 * }} UpdateState
 */

export class UpdateService extends EventEmitter {
  /**
   * @param {{
   *  updater?: any,
   *  currentVersion: string,
   *  config: unknown,
   *  logger?: {info?: Function, warn?: Function, error?: Function},
   *  beforeInstall?: () => Promise<void>,
   * }} options
   */
  constructor(options) {
    super()
    this.updater = options.updater
    this.config = normalizeUpdateConfig(options.config)
    this.log = options.logger ?? {}
    this.beforeInstall = options.beforeInstall ?? (async () => {})
    this.timer = undefined
    this.disposed = false
    /** @type {UpdateState} */
    this.state = {
      phase: this.updater !== undefined && this.config.enabled ? 'idle' : 'disabled',
      supported: this.updater !== undefined && this.config.enabled,
      currentVersion: options.currentVersion,
      availableVersion: null,
      progress: null,
      transferred: null,
      total: null,
      bytesPerSecond: null,
      releaseNotes: '',
      releaseUrl: this.config.releaseUrl,
      channel: this.config.channel,
      error: null,
      reason: this.updater === undefined ? '开发态与便携目录不执行在线更新' : this.config.reason,
    }
    if (this.state.supported) this.bindUpdater()
  }

  bindUpdater() {
    const updater = this.updater
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = true
    updater.autoRunAppAfterInstall = true
    updater.allowDowngrade = false
    updater.fullChangelog = true
    updater.disableWebInstaller = true
    this.applyFeed(this.config.channel)

    updater.on('checking-for-update', () => this.patch({ phase: 'checking', error: null }))
    updater.on('update-available', (info) => this.patch({
      phase: 'available',
      availableVersion: textOrNull(info?.version),
      releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
      progress: null,
      error: null,
    }))
    updater.on('update-not-available', () => this.patch({
      phase: 'not-available',
      availableVersion: null,
      progress: null,
      error: null,
    }))
    updater.on('download-progress', (progress) => this.patch({
      phase: 'downloading',
      progress: Number.isFinite(progress?.percent) ? Math.max(0, Math.min(100, progress.percent)) : null,
      transferred: Number.isFinite(progress?.transferred) ? progress.transferred : null,
      total: Number.isFinite(progress?.total) ? progress.total : null,
      bytesPerSecond: Number.isFinite(progress?.bytesPerSecond) ? progress.bytesPerSecond : null,
      error: null,
    }))
    updater.on('update-downloaded', (info) => this.patch({
      phase: 'downloaded',
      availableVersion: textOrNull(info?.version) ?? this.state.availableVersion,
      releaseNotes: normalizeReleaseNotes(info?.releaseNotes) || this.state.releaseNotes,
      progress: 100,
      error: null,
    }))
    updater.on('update-cancelled', () => this.patch({ phase: 'available', progress: null }))
    updater.on('error', (error) => this.fail(error))
  }

  /** @param {'stable' | 'beta'} channel */
  applyFeed(channel) {
    this.updater.allowPrerelease = channel === 'beta'
    this.updater.allowDowngrade = false
    this.updater.setFeedURL({
      provider: 'github',
      owner: this.config.owner,
      repo: this.config.repo,
      channel: channel === 'beta' ? 'beta' : 'latest',
    })
  }

  /** @param {unknown} requested */
  setChannel(requested) {
    if (!this.state.supported) return this.getState()
    const channel = requested === 'beta' ? 'beta' : 'stable'
    this.config.channel = channel
    this.applyFeed(channel)
    this.patch({
      phase: 'idle',
      channel,
      availableVersion: null,
      progress: null,
      releaseNotes: '',
      error: null,
    })
    return this.getState()
  }

  /** @returns {UpdateState} */
  getState() {
    return { ...this.state }
  }

  /** @param {Partial<UpdateState>} patch */
  patch(patch) {
    if (patch.phase !== undefined && !PHASES.has(patch.phase)) throw new Error(`未知更新状态：${String(patch.phase)}`)
    this.state = { ...this.state, ...patch }
    this.emit('state', this.getState())
  }

  /** @param {unknown} error */
  fail(error) {
    const detail = safeUpdateError(error)
    this.log.warn?.(`更新失败：${detail}`)
    this.patch({ phase: 'error', error: detail, progress: null })
    return this.getState()
  }

  async check() {
    if (!this.state.supported) return this.getState()
    if (['checking', 'downloading', 'installing'].includes(this.state.phase)) return this.getState()
    this.patch({ phase: 'checking', error: null, progress: null })
    try {
      const result = await this.updater.checkForUpdates()
      if (result === null && this.state.phase === 'checking') {
        this.patch({ phase: 'not-available', availableVersion: null })
      }
    } catch (error) {
      this.fail(error)
    }
    return this.getState()
  }

  async download() {
    if (!this.state.supported) return this.getState()
    if (this.state.phase === 'downloading' || this.state.phase === 'downloaded') return this.getState()
    if (this.state.phase !== 'available') return this.fail(new Error('请先检查更新'))
    this.patch({ phase: 'downloading', progress: 0, error: null })
    try {
      await this.updater.downloadUpdate()
    } catch (error) {
      this.fail(error)
    }
    return this.getState()
  }

  async install() {
    if (!this.state.supported) return this.getState()
    if (this.state.phase !== 'downloaded') return this.fail(new Error('更新尚未下载完成'))
    this.patch({ phase: 'installing', error: null })
    try {
      await this.beforeInstall()
      this.updater.quitAndInstall(false, true)
    } catch (error) {
      this.fail(error)
    }
    return this.getState()
  }

  /** @param {{enabled: boolean, delayMs?: number}} options */
  startAutoCheck(options) {
    if (!options.enabled || !this.state.supported || this.timer !== undefined) return false
    const delayMs = Math.max(1_000, options.delayMs ?? 30_000)
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (!this.disposed) void this.check()
    }, delayMs)
    this.timer.unref?.()
    return true
  }

  dispose() {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.removeAllListeners()
  }
}
