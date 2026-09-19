import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { configureGitHubUpdates, parseGitHubRepository } from '../scripts/configure-github-updates.mjs'

test('GitHub repository configuration accepts only owner/repo and writes no credential', async () => {
  assert.deepEqual(parseGitHubRepository('acme/harness'), { owner: 'acme', repo: 'harness' })
  assert.throws(() => parseGitHubRepository('https://github.com/acme/harness'))

  const root = await mkdtemp(join(tmpdir(), 'dsh-update-config-'))
  const output = join(root, 'update-config.json')
  try {
    const config = await configureGitHubUpdates('acme/harness', { output })
    assert.equal(config.owner, 'acme')
    const text = await readFile(output, 'utf8')
    assert.doesNotMatch(text, /token|password|secret/iu)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
