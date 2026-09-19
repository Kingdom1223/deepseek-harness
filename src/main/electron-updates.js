/** Electron / electron-updater 适配层。纯状态逻辑位于 update-service.js。 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { resourcesDir } from './paths.js'
import { UpdateService } from './update-service.js'

async function readUpdateConfig() {
  try {
    return JSON.parse(await readFile(join(resourcesDir(), 'update-config.json'), 'utf8'))
  } catch (error) {
    return { provider: 'github', error: String(error) }
  }
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
