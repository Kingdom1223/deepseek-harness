/** 校验更新清单与安装包来自同一次构建，避免发布无法安装的 latest.yml。 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
const files = await readdir(resolve('dist'))
const metadataName = files.find((name) => /^(?:latest|beta)\.yml$/u.test(name))
assert.ok(metadataName, 'dist 中缺少 latest.yml 或 beta.yml')
const metadata = await readFile(join(resolve('dist'), metadataName), 'utf8')

const readField = (name) => {
  const match = new RegExp(`^${name}:\\s*["']?(.+?)["']?\\s*$`, 'mu').exec(metadata)
  assert.ok(match?.[1], `${metadataName} 缺少 ${name}`)
  return match[1]
}

const version = readField('version')
const artifactName = readField('path')
const expectedSha512 = readField('sha512')
assert.equal(version, manifest.version, '更新清单版本与 package.json 不一致')

const artifact = join(resolve('dist'), artifactName)
assert.ok(existsSync(artifact), `更新清单引用的安装包不存在：${artifactName}`)
assert.ok(existsSync(`${artifact}.blockmap`), `缺少差分更新文件：${artifactName}.blockmap`)
const actualSha512 = createHash('sha512').update(await readFile(artifact)).digest('base64')
assert.equal(actualSha512, expectedSha512, '更新清单 SHA512 与安装包不一致')

process.stdout.write(`更新产物校验通过：${metadataName} → ${basename(artifact)} (${version})\n`)
