/**
 * Electron 打包态的 DSH subprocess runner 适配。
 *
 * dsh-subprocess-local 用 `process.execPath runner.js` 创建私有 Windows Job
 * runner。在普通 Node 中这是正确的；在 Electron 打包应用中 process.execPath
 * 指向桌面 EXE，不加 ELECTRON_RUN_AS_NODE 就会再次启动整套应用，最终以 0 退出但
 * 从未通过 IPC 报告目标进程结果。
 *
 * 这里只改带有 DSH_SUBPROCESS_RUNNER 私有标记、且可执行文件就是当前 Electron
 * 主程序的那一次 spawn。目标命令的环境在 provider 内已经提前生成，不会继承
 * ELECTRON_RUN_AS_NODE；普通子进程也完全不受影响。
 */
import { createRequire, syncBuiltinESMExports } from 'node:module'

const require = createRequire(import.meta.url)
const childProcess = require('node:child_process')
const BRIDGE = Symbol.for('dsh-desktop.electron-node-runner-bridge')
const RUNNER_ENV = 'DSH_SUBPROCESS_RUNNER'

/**
 * 仅为 DSH 私有 runner 补 Electron 的 Node 模式环境。
 * @param {string} command
 * @param {import('node:child_process').SpawnOptions | undefined} options
 * @param {string} execPath
 * @param {boolean} electron
 * @returns {import('node:child_process').SpawnOptions | undefined}
 */
export function electronNodeRunnerOptions(command, options, execPath, electron) {
  if (!electron || command !== execPath || options?.env?.[RUNNER_ENV] === undefined) return options
  return {
    ...options,
    env: {
      ...options.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
  }
}

/** 安装一次进程级 bridge；后续动态导入的 provider 会拿到同步后的 spawn。 */
export function installElectronNodeRunnerBridge() {
  if (process.versions.electron === undefined) return false
  if (childProcess.spawn[BRIDGE] === true) return true

  const originalSpawn = childProcess.spawn
  const bridgedSpawn = function (command, args, options) {
    const patched = electronNodeRunnerOptions(command, options, process.execPath, true)
    return originalSpawn.call(this, command, args, patched)
  }
  Object.defineProperty(bridgedSpawn, BRIDGE, { value: true })
  childProcess.spawn = bridgedSpawn
  syncBuiltinESMExports()
  return true
}
