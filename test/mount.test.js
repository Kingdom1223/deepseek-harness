import assert from 'node:assert/strict'
import test from 'node:test'

import { isBareModuleSpecifier } from '../src/main/mount.js'

test('bare module classifier keeps host packages separate from profile paths', () => {
  assert.equal(isBareModuleSpecifier('@deepseek-ai/dsh-agent-presets'), true)
  assert.equal(isBareModuleSpecifier('@deepseek-ai/dsh-tool-fs/subpath'), true)
  assert.equal(isBareModuleSpecifier('plain-package'), true)

  assert.equal(isBareModuleSpecifier('./local-plugin.js'), false)
  assert.equal(isBareModuleSpecifier('../local-plugin.js'), false)
  assert.equal(isBareModuleSpecifier('file:///C:/plugins/local.js'), false)
  assert.equal(isBareModuleSpecifier('cordis:include'), false)
  assert.equal(isBareModuleSpecifier('C:\\plugins\\local.js'), false)
  assert.equal(isBareModuleSpecifier(''), false)
  assert.equal(isBareModuleSpecifier(undefined), false)
})
