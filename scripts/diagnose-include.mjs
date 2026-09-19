/**
 * 诊断：检查根 include 条目本身拿到了什么配置，以及它为什么没展开出子树。
 *
 * 「传了 152 个条目但树里只有 1 个」这类问题只能在挂载后从活的 entry 上看。
 *
 * 用法：electron scripts/diagnose-include.mjs
 */
import { app } from 'electron'

app.whenReady().then(async () => {
  const out = (line) => process.stdout.write(`${line}\n`)
  const { boot, composeEntries, loadOptionalPatches, loadProfileDirectory } = await import('@deepseek-ai/dsh-app-boot')
  const { installAnchor, profileDir, profileRootConfigPath } = await import('../src/main/paths.js')

  const loaded = loadProfileDirectory('dsh-desktop', profileDir(), installAnchor())
  const patchLayers = [
    ...loaded.layers.map((layer) => layer.patches),
    ...(loadOptionalPatches('dsh-desktop', loaded.patchPath) ?? []),
  ]

  out(`patchLayers: ${String(patchLayers.length)} 层`)
  for (const [index, layer] of patchLayers.entries()) {
    out(`  层 ${String(index)}: ${Array.isArray(layer) ? `${String(layer.length)} 条 patch` : typeof layer}`)
    if (Array.isArray(layer)) {
      for (const patch of layer.slice(0, 3)) {
        out(`    - id=${JSON.stringify(patch?.id)} insert=${Array.isArray(patch?.insert) ? `${String(patch.insert.length)} 项` : String(patch?.insert)}`)
      }
    }
  }

  const ctx = await boot('dsh-desktop', profileRootConfigPath(), patchLayers, (hostCtx) => {
    hostCtx.provide('appExit', () => {})
    hostCtx.provide('cmdlineArgs', { get: () => Object.freeze([]) })
    hostCtx.provide('webStartup', { host: '127.0.0.1', port: 0, get trustedHosts() { return [] } })
  })

  const loader = ctx.get('loader')
  const entries = [...(loader?.entries?.() ?? [])]
  out(`\nloader.entries() 长度：${String(entries.length)}`)
  for (const entry of entries) {
    const state = entry.fiber?.state
    out(`  id=${JSON.stringify(entry.options?.id)} name=${JSON.stringify(entry.options?.name)} state=${String(state)}`)
    out(`    subtree=${entry.subtree === undefined ? 'undefined' : 'present'}`)
    const config = entry.options?.config
    if (config !== undefined) {
      out(`    config.path=${JSON.stringify(config.path)}`)
      out(`    config.patches=${Array.isArray(config.patches) ? `${String(config.patches.length)} 层` : JSON.stringify(config.patches)}`)
      if (Array.isArray(config.patches)) {
        for (const layer of config.patches) {
          out(`      · ${Array.isArray(layer) ? `${String(layer.length)} 条` : typeof layer}`)
        }
      }
    }
  }

  out(`\nloader.store 键：${JSON.stringify(Object.keys(loader?.store ?? {}))}`)
  try {
    const include = loader.resolve('include')
    out(`resolve('include') 成功，state=${String(include.fiber?.state)}`)
    out(`  _initTask=${include._initTask === undefined ? 'undefined' : 'present'}`)
    const subtree = include.subtree
    out(`  subtree.store 键数=${String(Object.keys(subtree?.store ?? {}).length)}`)
    const keys = Object.keys(subtree?.store ?? {})
    out(`  前 8 个：${JSON.stringify(keys.slice(0, 8))}`)
    const subEntries = [...(subtree?.entries?.() ?? [])]
    out(`  subtree.entries() 长度=${String(subEntries.length)}`)
    for (const entry of subEntries.slice(0, 5)) {
      out(`    - id=${JSON.stringify(entry.options?.id)} name=${JSON.stringify(entry.options?.name)} state=${String(entry.fiber?.state)}`)
    }
    // include 插件实际读到的文件内容与 patches 应用结果
    const data = include.instance?.data
    out(`  instance.data 类型=${Array.isArray(data) ? `array(${String(data.length)})` : typeof data}`)
    if (Array.isArray(data)) {
      out(`  data 前 3 项 id：${JSON.stringify(data.slice(0, 3).map((row) => row?.id))}`)
    }
  } catch (error) {
    out(`resolve('include') 失败：${error.message}`)
  }

  app.exit(0)
})
