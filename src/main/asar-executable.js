/**
 * 把 Electron ASAR 内的原生可执行文件路径映射到物理解包目录。
 *
 * Node/Electron 的 fs 能透明读取 `app.asar/...`，但 CreateProcessW 不能执行虚拟
 * ASAR 路径。electron-builder 已按 asarUnpack 把这些文件放在同级
 * `app.asar.unpacked/...`；此处在统一 subprocess 边界修正 argv[0]，避免每个工具
 * 分别认识 Electron 打包布局。
 */
import { existsSync } from 'node:fs'
import { extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const BRIDGE = Symbol.for('dsh-desktop.asar-executable-bridge')
const ELECTRON_NODE_SCRIPT = fileURLToPath(new URL('./electron-node-script.js', import.meta.url))

/**
 * @param {unknown} executable
 * @param {(path: string) => boolean} [exists]
 * @returns {unknown}
 */
export function physicalAsarExecutable(executable, exists = existsSync) {
  if (typeof executable !== 'string') return executable
  const normalized = executable.replaceAll('/', sep).replaceAll('\\', sep)
  const marker = `${sep}app.asar${sep}`
  const index = normalized.toLowerCase().indexOf(marker.toLowerCase())
  if (index < 0) return executable
  const physical = `${normalized.slice(0, index)}${sep}app.asar.unpacked${sep}${normalized.slice(index + marker.length)}`
  return exists(physical) ? physical : executable
}

/**
 * 把 `Electron.exe runner.js ...` 改为一次性的 Node 模式跳板。
 *
 * 只识别当前 Electron 主程序 + 已存在的 Node 脚本，普通可执行文件和用户命令
 * 不受影响。ELECTRON_RUN_AS_NODE 只用于启动跳板；跳板在加载 runner 前删除它。
 *
 * @param {any} spec
 * @param {{electron?: boolean, execPath?: string, bridgePath?: string, exists?: (path: string) => boolean}} [options]
 * @returns {any}
 */
export function bridgeElectronNodeScript(spec, options = {}) {
  const electron = options.electron ?? process.versions.electron !== undefined
  const execPath = options.execPath ?? process.execPath
  const bridgePath = options.bridgePath ?? ELECTRON_NODE_SCRIPT
  const exists = options.exists ?? existsSync
  const argv = Array.isArray(spec?.argv) ? spec.argv : undefined
  const target = argv?.[1]

  if (!electron || argv === undefined || argv[0] !== execPath) return spec
  if (typeof target !== 'string' || !['.js', '.mjs', '.cjs'].includes(extname(target).toLowerCase())) return spec
  if (target === bridgePath || !exists(target) || !exists(bridgePath)) return spec

  return {
    ...spec,
    argv: [execPath, bridgePath, target, ...argv.slice(2)],
    env: {
      ...spec.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
  }
}

/**
 * 给 DSH subprocess 服务安装一次 argv[0] 物理路径映射。
 * @param {{spawn: (spec: any) => any} | undefined} subprocess
 * @returns {boolean}
 */
export function installAsarExecutableBridge(subprocess) {
  if (subprocess === undefined || typeof subprocess.spawn !== 'function') return false
  if (subprocess[BRIDGE] === true) return true

  const originalSpawn = subprocess.spawn.bind(subprocess)
  subprocess.spawn = (spec) => {
    const argv = Array.isArray(spec?.argv) ? [...spec.argv] : spec?.argv
    if (Array.isArray(argv) && argv.length > 0) argv[0] = physicalAsarExecutable(argv[0])
    const mapped = Array.isArray(argv) ? { ...spec, argv } : spec
    return originalSpawn(bridgeElectronNodeScript(mapped))
  }
  Object.defineProperty(subprocess, BRIDGE, { value: true })
  return true
}
