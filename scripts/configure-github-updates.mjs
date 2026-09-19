/** 把 GitHub Actions 的 owner/repo 注入发布包资源；不会写入任何 Token。 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function parseGitHubRepository(value) {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u.exec(value ?? '')
  if (match === null) throw new Error('需要 DSH_GITHUB_REPOSITORY=owner/repo')
  return { owner: match[1], repo: match[2] }
}

export async function configureGitHubUpdates(repository, options = {}) {
  const { owner, repo } = parseGitHubRepository(repository)
  const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
  const channel = String(manifest.version).includes('-') ? 'beta' : 'stable'
  const target = resolve(options.output ?? 'resources/update-config.json')
  const config = { provider: 'github', owner, repo, channel }
  await writeFile(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return config
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const repository = process.argv[2] ?? process.env.DSH_GITHUB_REPOSITORY ?? process.env.GITHUB_REPOSITORY
  const config = await configureGitHubUpdates(repository)
  process.stdout.write(`更新源已配置：https://github.com/${config.owner}/${config.repo}/releases（${config.channel}）\n`)
}
