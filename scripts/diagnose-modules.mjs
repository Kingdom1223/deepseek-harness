/**
 * 诊断：逐个 import DSH 里带原生依赖或特殊内建模块的包，找出哪个在 Electron 里崩。
 *
 * Electron 的 Node ABI 与官方 Node 不同：node-pty / koffi / sharp 这类原生模块
 * 若没有针对 electron 预编译，加载时会硬崩（不是抛错，是整进程消失）。
 * 所以必须一个一个试，并且每个都单独报告。
 *
 * 用法：electron scripts/diagnose-modules.mjs
 */
import { app } from 'electron'

/** 按风险从高到低排列的待测包。 */
const SUSPECTS = [
  '@deepseek-ai/dsh-session-query-sqlite',
  '@deepseek-ai/dsh-pwsh-local',
  '@deepseek-ai/dsh-pwsh-sandbox',
  '@deepseek-ai/dsh-bash-local',
  '@deepseek-ai/dsh-sandbox-local',
  '@deepseek-ai/dsh-sandbox-windows-acl',
  '@deepseek-ai/dsh-terminal',
  '@deepseek-ai/dsh-terminal-bash',
  '@deepseek-ai/dsh-attachment-local',
  '@deepseek-ai/dsh-fs-local',
  '@deepseek-ai/dsh-session-persistence-jsonl',
  '@deepseek-ai/dsh-credentials-local',
  '@deepseek-ai/dsh-code-runtime-worker-thread',
  '@deepseek-ai/dsh-workflow-worker-thread',
  '@deepseek-ai/dsh-subprocess-local',
  '@deepseek-ai/dsh-jobs-local',
  '@deepseek-ai/dsh-spill-local',
  '@deepseek-ai/dsh-native-command',
  '@deepseek-ai/dsh-win32-process',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-settings-file',
  '@deepseek-ai/dsh-storage-json',
  '@deepseek-ai/dsh-hooks-codex',
  '@deepseek-ai/dsh-hooks-claude-code',
  '@deepseek-ai/dsh-host-directory-picker-native',
  '@deepseek-ai/dsh-host-webserver',
]

app.whenReady().then(async () => {
  for (const name of SUSPECTS) {
    process.stdout.write(`试 ${name} … `)
    try {
      // 用动态 import：能拿到真正的模块求值错误。
      await import(name)
      process.stdout.write('ok\n')
    } catch (error) {
      process.stdout.write(`失败：${error?.message ?? String(error)}\n`)
    }
  }

  process.stdout.write('\n── 原生模块直接加载 ──\n')
  for (const name of ['node-pty', 'koffi', 'sharp', 'node:sqlite', '@deepseek-ai/node-addon-system']) {
    process.stdout.write(`试 ${name} … `)
    try {
      const loaded = await import(name)
      process.stdout.write(`ok（导出 ${String(Object.keys(loaded).length)} 项）\n`)
    } catch (error) {
      process.stdout.write(`失败：${error?.message ?? String(error)}\n`)
    }
  }

  process.stdout.write('\n完成。\n')
  app.exit(0)
})
