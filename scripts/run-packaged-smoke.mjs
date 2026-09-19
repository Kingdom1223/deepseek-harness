/** 启动已打包或当前已安装应用的无窗口自检，避免 shell 对空格路径的二次解析。 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const installed = process.argv.includes('--installed')
const executable = installed
  ? join(process.env.LOCALAPPDATA ?? '', 'Programs', 'deepseek-harness-desktop', 'DeepSeek Harness.exe')
  : join(process.cwd(), 'dist', 'win-unpacked', 'DeepSeek Harness.exe')
if (!existsSync(executable)) {
  process.stderr.write(installed
    ? `缺少已安装主程序：${executable}\n请先安装 DeepSeek Harness。\n`
    : `缺少打包产物：${executable}\n请先运行 npm run pack:dir\n`)
  process.exit(1)
}

const userData = mkdtempSync(join(tmpdir(), 'dsh-desktop-smoke-'))

async function cleanup() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(userData, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt === 19) throw error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}

let launchError
const child = spawn(executable, ['--smoke-test'], {
  cwd: process.cwd(),
  env: { ...process.env, DSH_SMOKE_USER_DATA: userData },
  stdio: 'inherit',
  windowsHide: true,
})

child.once('error', (error) => {
  launchError = error
})
child.once('close', async (code, signal) => {
  let exitCode = code ?? 1
  if (launchError !== undefined) {
    process.stderr.write(`无法启动打包产物：${String(launchError)}\n`)
    exitCode = 1
  }
  if (signal !== null) {
    process.stderr.write(`打包自检被信号终止：${signal}\n`)
    exitCode = 1
  }
  await cleanup().catch((error) => {
    process.stderr.write(`打包自检临时目录清理失败：${String(error)}\n`)
    exitCode = 1
  })
  process.exitCode = exitCode
})
