/**
 * Windows 安装器端到端检查：静默安装到独立临时目录，运行发布包自检，再卸载。
 *
 * NSIS 会按应用身份查找当前用户已有安装；即使传了临时 `/D`，它仍可能先执行
 * 升级/卸载流程。因此这项门禁只能在没有正式安装的干净用户或 CI/VM 中运行。
 * 下面的前置检查宁可明确失败，也不能用一次测试替换用户正在使用的程序。
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (process.platform !== 'win32') {
  process.stderr.write('安装器自检目前只支持 Windows。\n')
  process.exit(1)
}

const manifest = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'))
const artifactTemplate = manifest.build?.win?.artifactName
assert.equal(typeof artifactTemplate, 'string', 'package.json 缺少 build.win.artifactName')
const artifactName = artifactTemplate
  .replaceAll('${version}', manifest.version)
  .replaceAll('${ext}', 'exe')
  .replaceAll('${arch}', 'x64')
  .replaceAll('${productName}', manifest.productName)
  .replaceAll('${name}', manifest.name)
const installer = join(process.cwd(), 'dist', artifactName)
if (!existsSync(installer)) {
  process.stderr.write(`缺少安装器：${installer}\n请先运行 npm run build:win\n`)
  process.exit(1)
}

const localAppData = process.env.LOCALAPPDATA
if (typeof localAppData === 'string' && localAppData !== '') {
  const installedExecutable = join(
    localAppData,
    'Programs',
    'deepseek-harness-desktop',
    `${manifest.productName}.exe`,
  )
  if (existsSync(installedExecutable)) {
    process.stderr.write(
      `检测到现有安装：${installedExecutable}\n` +
      '为防止 NSIS 将临时安装识别成升级并覆盖现有版本，安装器自检已停止。\n' +
      '请在干净的 Windows 用户、CI 或虚拟机中运行 npm run test:installer。\n',
    )
    process.exit(1)
  }
}

const root = mkdtempSync(join(tmpdir(), 'dsh-installer-smoke-'))
const installDir = join(root, 'app')
const userData = join(root, 'user-data')

/** @param {string} file @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
function run(file, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${file} 在 180000ms 内没有退出`))
    }, 180_000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      if (signal !== null) reject(new Error(`${file} 被信号终止：${signal}`))
      else if (code !== 0) reject(new Error(`${file} 退出码 ${String(code)}`))
      else resolve()
    })
  })
}

async function cleanup() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt === 29) throw error
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
}

/** @returns {string | undefined} */
function uninstallerPath() {
  if (!existsSync(installDir)) return undefined
  const name = readdirSync(installDir).find((entry) => /^Uninstall.*\.exe$/i.test(entry))
  return name === undefined ? undefined : join(installDir, name)
}

let installed = false
try {
  process.stdout.write(`安装器自检目录：${root}\n`)
  const installStarted = performance.now()
  await run(installer, ['/S', `/D=${installDir}`])
  installed = true
  process.stdout.write(`静默安装完成：${Math.round(performance.now() - installStarted)}ms\n`)

  const executable = join(installDir, 'DeepSeek Harness.exe')
  assert.ok(existsSync(executable), `安装后缺少主程序：${executable}`)
  assert.ok(uninstallerPath() !== undefined, '安装后缺少卸载程序')

  const smokeStarted = performance.now()
  await run(executable, ['--smoke-test'], { ...process.env, DSH_SMOKE_USER_DATA: userData })
  process.stdout.write(`安装态运行自检完成：${Math.round(performance.now() - smokeStarted)}ms\n`)
  process.stdout.write('安装器端到端自检通过。\n')
} finally {
  const uninstaller = uninstallerPath()
  if (installed && uninstaller !== undefined) {
    const uninstallStarted = performance.now()
    await run(uninstaller, ['/S']).catch((error) => {
      process.stderr.write(`静默卸载失败：${String(error)}\n`)
      process.exitCode = 1
    })
    process.stdout.write(`静默卸载完成：${Math.round(performance.now() - uninstallStarted)}ms\n`)
  }
  await cleanup().catch((error) => {
    process.stderr.write(`安装器自检目录清理失败：${String(error)}\n`)
    process.exitCode = 1
  })
}
