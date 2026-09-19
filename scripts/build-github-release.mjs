/** 构建 GitHub Releases 更新产物，但不在本步骤上传。 */
import { readFile, rm } from 'node:fs/promises'

import { Arch, build, Platform } from 'electron-builder'

import { configureGitHubUpdates, parseGitHubRepository } from './configure-github-updates.mjs'

const repository = process.env.DSH_GITHUB_REPOSITORY ?? process.env.GITHUB_REPOSITORY
const { owner, repo } = parseGitHubRepository(repository)
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const prerelease = String(manifest.version).includes('-')
const channel = prerelease ? 'beta' : 'latest'

await configureGitHubUpdates(repository)

// electron-builder normally cleans this directory itself, but Windows can keep
// a stale resource handle from a previous smoke/build process. Release output
// is reproducible and disposable, so remove only dist/ before packaging and
// retry transient antivirus/indexer locks.
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })

await build({
  targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
  publish: 'never',
  config: {
    ...manifest.build,
    publish: [{
      provider: 'github',
      owner,
      repo,
      channel,
      releaseType: prerelease ? 'prerelease' : 'release',
    }],
  },
})
