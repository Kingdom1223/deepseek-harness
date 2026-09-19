/**
 * Electron 打包态的通用 Node 脚本跳板。
 *
 * 宿主只在启动本文件时设置 ELECTRON_RUN_AS_NODE。进入 Node 模式后立刻删除该
 * 变量，再加载真正的 runner；这样 runner 启动的用户命令不会继承 Electron 的
 * 私有启动开关，同时它看到的 process.argv 与 `node target.js ...args` 保持一致。
 */
import { pathToFileURL } from 'node:url'

const [target, ...args] = process.argv.slice(2)

delete process.env.ELECTRON_RUN_AS_NODE

if (target === undefined) {
  process.stderr.write('dsh-desktop electron-node-script: missing target Node script\n')
  process.exitCode = 127
} else {
  process.argv = [process.argv[0], target, ...args]
  await import(pathToFileURL(target).href)
}
