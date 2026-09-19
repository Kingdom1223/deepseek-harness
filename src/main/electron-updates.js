/** Electron / electron-updater 适配层。纯状态逻辑位于 update-service.js。 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { APP_ROOT, resourcesDir } from './paths.js'
import { UpdateService } from './update-service.js'

async function readUpdateConfig() {
  const candidates = [
    join(resourcesDir(), 'update-config.json'),
    join(APP_ROOT, 'resources', 'update-config.json'),
  ]
  let lastError
  for (const candidate of new Set(candidates)) {
    try {
      return JSON.parse(await readFile(candidate, 'utf8'))
    } catch (error) {
      lastError = error
    }
  }
  return { provider: 'github', error: String(lastError) }
}

/**
 * @param {{app: import('electron').App, logger?: any, channel?: unknown, beforeInstall?: () => Promise<void>}} options
 */
export async function createElectronUpdateService(options) {
  const config = await readUpdateConfig()
  if (options.channel === 'stable' || options.channel === 'beta') config.channel = options.channel
  let updater
  if (options.app.isPackaged) {
    const module = await import('electron-updater')
    updater = module.autoUpdater ?? module.default?.autoUpdater
  }
  return new UpdateService({
    updater,
    currentVersion: options.app.getVersion(),
    config,
    logger: options.logger,
    beforeInstall: options.beforeInstall,
  })
}
