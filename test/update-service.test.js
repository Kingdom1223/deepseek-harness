import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { normalizeUpdateConfig, safeUpdateError, UpdateService } from '../src/main/update-service.js'

class FakeUpdater extends EventEmitter {
  setFeedURL(value) { this.feed = value }
  async checkForUpdates() { return { updateInfo: { version: '0.2.0' } } }
  async downloadUpdate() { return ['update.exe'] }
  quitAndInstall(silent, runAfter) { this.installArgs = [silent, runAfter] }
}

const config = { provider: 'github', owner: 'deepseek-test', repo: 'harness', channel: 'stable' }

test('GitHub update config is enabled only with a complete repository identity', () => {
  assert.equal(normalizeUpdateConfig(config).enabled, true)
  assert.equal(normalizeUpdateConfig({ provider: 'github', owner: '', repo: 'harness' }).enabled, false)
  assert.equal(normalizeUpdateConfig({ provider: 'generic', owner: 'a', repo: 'b' }).enabled, false)
})

test('update service exposes a stable check-download-install state machine', async () => {
  const updater = new FakeUpdater()
  let prepared = false
  const service = new UpdateService({
    updater,
    currentVersion: '0.1.0',
    config,
    beforeInstall: async () => { prepared = true },
  })

  assert.deepEqual(updater.feed, {
    provider: 'github', owner: 'deepseek-test', repo: 'harness', channel: 'latest',
  })
  assert.equal(service.getState().phase, 'idle')
  assert.equal(service.setChannel('beta').channel, 'beta')
  assert.equal(updater.feed.channel, 'beta')
  service.setChannel('stable')

  await service.check()
  assert.equal(service.getState().phase, 'checking')
  updater.emit('update-available', { version: '0.2.0', releaseNotes: '修复更新链路' })
  assert.equal(service.getState().phase, 'available')

  await service.download()
  updater.emit('download-progress', { percent: 42, transferred: 42, total: 100, bytesPerSecond: 10 })
  assert.equal(service.getState().progress, 42)
  updater.emit('update-downloaded', { version: '0.2.0' })
  assert.equal(service.getState().phase, 'downloaded')

  await service.install()
  assert.equal(prepared, true)
  assert.deepEqual(updater.installArgs, [false, true])
  assert.equal(service.getState().phase, 'installing')
})

test('disabled builds do not contact GitHub and errors redact credentials', async () => {
  const service = new UpdateService({ currentVersion: '0.1.0', config: {} })
  assert.equal(service.getState().phase, 'disabled')
  assert.equal((await service.check()).phase, 'disabled')
  assert.doesNotMatch(safeUpdateError('https://x.test/a?token=secret&x=1'), /secret/u)
})
