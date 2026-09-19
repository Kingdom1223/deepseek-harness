/**
 * Electron 宿主自己的工作区选择能力。
 *
 * 官方 Windows picker 为独立 Node 主机设计，会用 `process.execPath` 启动一个
 * COM worker。打包进 Electron 后 `process.execPath` 是桌面 EXE，子进程因此会
 * 再次启动应用而不是执行 worker。桌面宿主已经拥有可靠的系统对话框，直接把
 * 它接到 DSH 的 `directoryPicker` 能力缝隙即可。
 */

/** @returns {Error} 与平台 API 一致的取消错误。 */
function aborted() {
  return new DOMException('directory picker aborted', 'AbortError')
}

/**
 * @param {() => Promise<string | null>} pickDirectory
 * @returns {{capability: () => {kind: 'native', pick: (signal: AbortSignal) => Promise<string | null>}}}
 */
export function createDesktopDirectoryPicker(pickDirectory) {
  if (typeof pickDirectory !== 'function') throw new TypeError('pickDirectory must be a function')

  const capability = Object.freeze({
    kind: 'native',
    pick: async (signal) => {
      if (signal.aborted) throw aborted()
      const path = await pickDirectory()
      if (signal.aborted) throw aborted()
      return typeof path === 'string' && path !== '' ? path : null
    },
  })

  return Object.freeze({ capability: () => capability })
}

