import assert from 'node:assert/strict'
import test from 'node:test'

import { createDesktopDirectoryPicker } from '../src/main/directory-picker.js'

test('desktop directory picker exposes the native DSH capability', async () => {
  const picker = createDesktopDirectoryPicker(async () => 'C:\\workspace')
  const capability = picker.capability()
  assert.equal(capability.kind, 'native')
  assert.equal(await capability.pick(new AbortController().signal), 'C:\\workspace')
})

test('desktop directory picker maps cancellation and abort correctly', async () => {
  const picker = createDesktopDirectoryPicker(async () => null)
  assert.equal(await picker.capability().pick(new AbortController().signal), null)

  const controller = new AbortController()
  controller.abort()
  await assert.rejects(picker.capability().pick(controller.signal), { name: 'AbortError' })
})

