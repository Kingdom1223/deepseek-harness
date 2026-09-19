import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { bridgeElectronNodeScript, physicalAsarExecutable } from '../src/main/asar-executable.js'

const HERE = dirname(fileURLToPath(import.meta.url))

test('ASAR executable mapper only selects an existing unpacked native path', () => {
  const virtual = 'C:\\App\\resources\\app.asar\\node_modules\\tool\\bin\\tool.exe'
  const expected = 'C:\\App\\resources\\app.asar.unpacked\\node_modules\\tool\\bin\\tool.exe'

  assert.equal(physicalAsarExecutable(virtual, (path) => path === expected), expected)
  assert.equal(physicalAsarExecutable(virtual, () => false), virtual)
  assert.equal(physicalAsarExecutable('C:\\Tools\\tool.exe', () => true), 'C:\\Tools\\tool.exe')
  assert.equal(physicalAsarExecutable(undefined, () => true), undefined)
})

test('Electron Node script bridge only wraps existing Node runners', () => {
  const execPath = 'C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe'
  const bridgePath = 'C:\\App\\resources\\app.asar\\src\\main\\electron-node-script.js'
  const target = 'C:\\App\\resources\\app.asar\\node_modules\\runner\\index.js'
  const existing = new Set([bridgePath, target])
  const original = { argv: [execPath, target, '--flag'], env: { NO_COLOR: '1' } }
  const patched = bridgeElectronNodeScript(original, {
    electron: true,
    execPath,
    bridgePath,
    exists: (path) => existing.has(path),
  })

  assert.deepEqual(patched.argv, [execPath, bridgePath, target, '--flag'])
  assert.deepEqual(patched.env, { NO_COLOR: '1', ELECTRON_RUN_AS_NODE: '1' })
  assert.equal(original.env.ELECTRON_RUN_AS_NODE, undefined)

  assert.equal(bridgeElectronNodeScript(original, { electron: false, execPath, bridgePath }), original)
  assert.equal(bridgeElectronNodeScript({ argv: [execPath, 'pwsh.exe'] }, {
    electron: true,
    execPath,
    bridgePath,
    exists: () => true,
  }).argv[1], 'pwsh.exe')
})

test('Electron Node script bridge clears its private mode flag and preserves target argv', () => {
  const bridge = join(HERE, '..', 'src', 'main', 'electron-node-script.js')
  const target = join(HERE, '..', 'test-support', 'electron-node-target.mjs')
  const result = spawnSync(process.execPath, [bridge, target, 'alpha', 'two words'], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    argv: [target, 'alpha', 'two words'],
    electronRunAsNode: null,
  })
})
