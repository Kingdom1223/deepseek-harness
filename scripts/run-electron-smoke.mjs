/** 在外层 Node 进程中运行 Electron 自检，待文件句柄释放后清理独立用户目录。 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import electronPath from 'electron'

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
const child = spawn(electronPath, ['scripts/electron-smoke.mjs'], {
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
    process.stderr.write(`无法启动 Electron 自检：${String(launchError)}\n`)
    exitCode = 1
  }
  if (signal !== null) {
    process.stderr.write(`Electron 自检被信号终止：${signal}\n`)
    exitCode = 1
  }
  await cleanup().catch((error) => {
    process.stderr.write(`自检临时目录清理失败：${String(error)}\n`)
    exitCode = 1
  })
  process.exitCode = exitCode
})
