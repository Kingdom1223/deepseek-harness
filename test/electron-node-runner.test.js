import assert from 'node:assert/strict'
import test from 'node:test'

import { electronNodeRunnerOptions } from '../src/main/electron-node-runner.js'

test('Electron Node runner bridge only patches the private DSH runner spawn', () => {
  const execPath = 'C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe'
  const runner = {
    cwd: 'C:\\workspace',
    env: { PATH: 'C:\\Windows', DSH_SUBPROCESS_RUNNER: 'windows' },
  }
  const patched = electronNodeRunnerOptions(execPath, runner, execPath, true)
  assert.notEqual(patched, runner)
  assert.equal(patched.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(runner.env.ELECTRON_RUN_AS_NODE, undefined)

  assert.equal(electronNodeRunnerOptions('pwsh.exe', runner, execPath, true), runner)
  assert.equal(electronNodeRunnerOptions(execPath, { env: {} }, execPath, true).env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(electronNodeRunnerOptions(execPath, runner, execPath, false), runner)
})
