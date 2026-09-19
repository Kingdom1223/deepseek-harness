/**
 * 手动组装 DSH 的 Cordis 树。
 *
 * 为什么不用 `boot()`：它把「等服务就绪 → 断言全部激活 → fail-loud」和
 * 「提供宿主服务（appExit / cmdlineArgs / webStartup / dshHomePath）」耦合在一起，
 * 而桌面载具需要自己决定这些服务的内容与时机（例如刻意不提供 `appReady` ——
 * 那会让 `dsh-web-app` 去 `loader.await()` 等整棵树，形成自己等自己的死锁）。
 *
 * 所以这里只做 boot 的后半段：建 Context、挂 Loader、提供服务、调用官方
 * `mountRootInclude` 挂树、等稳定、把未激活的条目拆成可读报告。
 */
import { mountRootInclude } from '@deepseek-ai/dsh-app-boot'
import { createRequire } from 'node:module'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * 判断 Loader 行是否使用宿主安装拥有的裸模块名。
 *
 * 相对路径属于 profile，自带文件继续以配置目录为基准；裸包名实际从桌面应用的
 * app.asar/node_modules 导入，它的插件上下文也必须携带同一个基准。动态 preset
 * 会把这个 `ctx.baseUrl` 传给自己的发现和挂载逻辑，二者不一致就会出现“包已经
 * 打进 app.asar，却被报告为 cannot be resolved”。
 *
 * @param {unknown} name - Loader 行的 name
 * @returns {boolean} 是否为裸模块名
 */
export function isBareModuleSpecifier(name) {
  return typeof name === 'string'
    && name !== ''
    && !name.startsWith('.')
    && !name.startsWith('file:')
    && !name.startsWith('cordis:')
    && !isAbsolute(name)
}

/**
 * 让裸模块行的运行上下文与它的实际导入基准一致。
 *
 * `mountRootInclude(..., bareModuleBaseUrl)` 只改变 import 的位置；Include 仍会把
 * 子行上下文的 baseUrl 设为 profile 目录。大多数插件感知不到这个差异，但
 * agent-presets 会把 baseUrl 当作后续动态组合的安装锚点，因此必须在插件启动前
 * 修正。这个 hook 是面向所有裸模块的通用宿主边界，后续新增动态插件不必再写
 * 包名特判。
 *
 * @param {any} ctx - Cordis 根上下文
 * @param {string | undefined} bareModuleBaseUrl - 宿主安装的 file: 目录 URL
 */
function installBareModuleContextBase(ctx, bareModuleBaseUrl) {
  if (bareModuleBaseUrl === undefined) return
  ctx.on('loader/patch-context', async (entry, next) => {
    await next()
    if (isBareModuleSpecifier(entry.options?.name)) entry.ctx.baseUrl = bareModuleBaseUrl
  })
}

/**
 * 补上 `loader.internal`（当宿主环境里它取不到时）。
 *
 * `cordis-plugin-loader` 通过 `node-addon-require-builtin` 的原生绑定去拿 Node
 * 内部的 ESM loader，拿不到就把 `loader.internal` 留成 undefined —— 而且失败是
 * 静默的（内部 try/catch 吞掉）。后果不是「少个可选能力」：`dsh-client-modules`
 * 靠 `internal.resolveSync` 把每个客户端插件的行解析成包目录，
 * 拿不到就直接返回「不是客户端包」，于是**整张客户端模块图为空**，
 * 界面以 "HTML did not preload client-modules" 告终。
 *
 * 这里按 loader 期望的两个入口提供等价实现：
 *
 *   `version: 'v1'` —— 记录这一侧的 `resolveSync` 是 (specifier, baseUrl, ctx) 形态，
 *   与 loader 里 v1 分支一致。
 *   `resolveSync(specifier, baseUrl, ctx) → { url }`
 *   `import(specifier, baseUrl, ctx) → module`
 *
 * 解析顺序刻意是「安装锚点优先，其次 baseUrl」：这正是官方 include 的约定。
 * 桌面版的 profile 目录随应用分发（`resources/desktop-profile`），而依赖装在
 * 应用自己的 `node_modules`（`resources/app/node_modules`）——两者是兄弟目录，
 * 只从 profile 向上找**永远找不到**。官方 include 用一个显式的安装基准解决它，
 * 这里的多锚点顺序是同一件事。
 *
 * @param {any} loader - Cordis loader 实例
 * @param {(message: string) => void} log - 诊断输出
 * @param {string[]} [installAnchors] - 额外的解析锚点（如应用安装目录）
 */
function ensureLoaderInternals(loader, log, installAnchors = []) {
  const existing = loader.internal
  if (existing !== undefined && typeof existing.resolveSync === 'function') return

  const requireFrom = (baseUrl) => {
    // baseUrl 可能是 file:// URL，也可能是目录路径。
    // 注意：createRequire 只接受路径字符串或 **URL 对象**——传 file:// 字符串
    // 会被当成字面路径，解析必然失败。
    if (baseUrl instanceof URL) return createRequire(baseUrl)
    if (typeof baseUrl === 'string' && baseUrl.startsWith('file:')) return createRequire(new URL(baseUrl))
    return createRequire(pathToFileURL(`${String(baseUrl ?? process.cwd()).replace(/[\\/]+$/, '')}/`))
  }

  /** 依次在安装锚点与 baseUrl 上尝试解析一个裸包名。 */
  const resolveBare = (specifier, baseUrl) => {
    const anchors = [...installAnchors, baseUrl]
    const failures = []
    for (const anchor of anchors) {
      if (anchor === undefined) continue
      try {
        return pathToFileURL(requireFrom(anchor).resolve(specifier)).href
      } catch (error) {
        failures.push(`${String(anchor)}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
      }
    }
    throw new Error(`dsh-desktop: 无法解析 ${JSON.stringify(specifier)}；试过 ${failures.join(' | ')}`)
  }

  /** 把 specifier 解析成可 import 的 file: URL（相对名按 baseUrl 解析）。 */
  const toImportUrl = (specifier, baseUrl) => {
    if (specifier.startsWith('file:')) return specifier
    if (specifier.startsWith('.')) {
      // 相对名必须以 baseUrl 为基准：直接 `import('./x.js')` 的基准是**调用模块**
      // 所在的文件，不是 baseUrl。
      const base = typeof baseUrl === 'string' && baseUrl.startsWith('file:') ? baseUrl : pathToFileURL(`${String(baseUrl ?? process.cwd())}/`).href
      return new URL(specifier, base).href
    }
    return resolveBare(specifier, baseUrl)
  }

  const shim = {
    version: 'v1',
    resolveSync(specifier, baseUrl) {
      return { url: toImportUrl(specifier, baseUrl) }
    },
    async import(specifier, baseUrl) {
      return import(toImportUrl(specifier, baseUrl))
    },
  }

  try {
    Object.defineProperty(loader, 'internal', {
      value: shim,
      writable: true,
      configurable: true,
    })
    log('loader.internal 缺失，已安装宿主侧等价实现（客户端插件扫描依赖它）')  } catch (error) {
    log(`loader.internal 注入失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Cordis fiber 状态码到可读名字。 */
const FIBER_STATE_NAMES = {
  0: 'PENDING',
  1: 'LOADING',
  2: 'ACTIVE',
  3: 'FAILED',
  4: 'DISPOSED',
  5: 'UNLOADING',
}

/**
 * 把一段错误连同它的 `cause` / `errors` 链渲染成可读文本。
 *
 * Cordis 的 loader 会把失败包成 `failed to <stage> loader entry …`，真正的原因在
 * `cause` 里。只打最外层等于什么都没说 —— 这类嵌套正是「同一份代码在开发态能跑、
 * 打包后不能跑」时唯一能指路的东西。
 *
 * @param {unknown} error - 待展开的错误
 * @param {number} [depth] - 当前深度（防御循环引用）
 * @returns {string} 多行文本
 */
function describeError(error, depth = 0) {
  const indent = '  '.repeat(depth)
  if (depth > 8) return `${indent}…（原因链过深，已截断）`
  if (error === null || error === undefined) return `${indent}${String(error)}`
  const message = error instanceof Error ? (error.message ?? String(error)) : String(error)
  const where = error instanceof Error && typeof error.stack === 'string' ? (error.stack.split('\n')[1]?.trim() ?? '') : ''
  const lines = [`${indent}${message}${where === '' ? '' : `\n${indent}  ${where}`}`]

  if (error instanceof AggregateError) {
    for (const nested of error.errors ?? []) lines.push(`${indent}  ↳ ${describeError(nested, depth + 2).trimStart()}`)
  }
  if (error instanceof Error && error.cause !== undefined && error.cause !== error) {
    lines.push(`${indent}  由以下原因引起：`)
    lines.push(describeError(error.cause, depth + 2))
  }
  return lines.join('\n')
}

/**
 * 挂载一棵树并等它稳定。
 *
 * @param {object} options
 * @param {any} options.Context - cordis 的 Context 类
 * @param {any} options.Loader - cordis-plugin-loader 的默认导出
 * @param {any[]} options.entries - 已展开的条目表（来自 applyEntryPatches）
 * @param {string} options.configPath - 根配置文件绝对路径（include 需要读它并应用 patches）
 * @param {any[]} options.patches - 未应用的 patch 列表（交给官方 include 应用）
 * @param {(ctx: any) => void | Promise<void>} [options.prepare] - 挂载前在根上下文上提供服务
 * @param {string} [options.baseUrl] - 相对模块解析基准
 * @param {string} [options.bareModuleBaseUrl] - 裸模块的宿主安装基准（file: 目录 URL）
 * @param {(message: string) => void} [options.log] - 诊断输出
 * @returns {Promise<{ctx: any, failures: string[], stalled: string[], timedOut: boolean}>}
 */
export async function mountTree(options) {
  const { Context, Loader } = options
  const log = options.log ?? (() => {})

  const ctx = new Context()
  // 让裸包名与相对路径都按预期解析（与 boot 的做法一致：config 目录 + "/"）。
  if (options.baseUrl !== undefined) ctx.baseUrl = options.baseUrl

  await ctx.plugin(Loader)
  const loader = ctx.get('loader')
  if (loader === undefined) throw new Error('dsh-desktop: Loader 挂载后 loader 服务仍不可用')
  ensureLoaderInternals(loader, log, options.installAnchors ?? [])
  installBareModuleContextBase(ctx, options.bareModuleBaseUrl)
  log(`Loader 已挂载，准备挂载 ${String(options.entries.length)} 个条目`)
  await options.prepare?.(ctx)
  log('宿主服务已提供')

  const failures = []
  const stalled = []
  const before = new Set([...ctx.loader.entries()])

  // 走官方 include：它负责读根配置、应用 patch 列表、再把条目挂进 loader 子树。
  //
  // 这一步刻意不用「自己逐条 loader.create」——那条路虽然初期诊断方便，
  // 但它绕过了 include 的模块解析上下文，导致 preset 里的子路径条目
  // （`@deepseek-ai/dsh-tool-subagent-control/list-agents` 这类）解析成
  // undefined，agent preset 挂不起来（会话就创建不了）。
  try {
    await mountRootInclude(ctx, options.configPath, options.patches, options.bareModuleBaseUrl)
  } catch (error) {
    failures.push(describeError(error))
    log(`include 挂载失败：\n${describeError(error)}`)
  }

  const added = [...ctx.loader.entries()].filter((entry) => !before.has(entry))

  // 等所有 fiber 稳定，包含仍在 init 中的服务（webServer 的 socket 绑定就在这一层）。
  //
  // 必须有超时：某一行若停在 inject 等待上，`await()` 会永远不返回，
  // 表现就是「进程活着、日志停住、没有窗口」。
  const timeoutMs = options.awaitTimeoutMs ?? 60_000
  let timedOut = false
  await Promise.race([
    ctx.loader.await(),
    new Promise((resolve) => {
      setTimeout(() => {
        timedOut = true
        resolve(undefined)
      }, timeoutMs)
    }),
  ])

  // 报告未激活的条目：include 是整体应用，失败会以聚合形式抛出，
  // 这里把它拆成逐条可读的输出。
  for (const entry of added) {
    const state = entry.fiber?.state
    if (state === 2) continue
    const label = `${String(entry.options?.name)}${entry.options?.id === undefined ? '' : ` (${String(entry.options.id)})`}`
    if (state === undefined) stalled.push(label)
    else failures.push(`${label}: ${FIBER_STATE_NAMES[state] ?? String(state)}`)
  }
  if (timedOut) log(`等待树稳定超时（${String(timeoutMs)}ms）`)

  log(`include 挂出 ${String(added.length)} 个条目，其中未激活 ${String(failures.length + stalled.length)} 个`)

  return { ctx, failures, stalled, timedOut }
}

/**
 * 把一棵树的状态渲染成可读报告。
 *
 * 「树稳定了」与「服务出现了」是两件不同的事：某一行可能停在 inject 等待上，
 * 此时树看起来稳定，但它的服务永远不会出现。这个报告同时给出两者。
 *
 * @param {any} ctx - Cordis 根上下文
 * @param {string[]} [watchedServices] - 想确认是否就位的服务名
 * @returns {string} 多行报告
 */
export function describeTree(ctx, watchedServices = []) {
  const lines = []
  const entries = [...(ctx.get('loader')?.entries?.() ?? [])]

  /** @type {Map<number, string[]>} */
  const grouped = new Map()
  for (const entry of entries) {
    const state = entry.fiber?.state
    const list = grouped.get(state) ?? []
    list.push(entry.options?.name ?? '(匿名)')
    grouped.set(state, list)
  }

  lines.push(`  条目：${String(entries.length)} 个`)
  for (const [state, names] of grouped) {
    lines.push(`    ${FIBER_STATE_NAMES[state] ?? `state=${String(state)}`} × ${String(names.length)}`)
    if (state !== 2) {
      for (const name of names.slice(0, 10)) lines.push(`      - ${name}`)
      if (names.length > 10) lines.push(`      … 另有 ${String(names.length - 10)} 个`)
    }
  }

  if (watchedServices.length > 0) {
    lines.push('  服务：')
    for (const service of watchedServices) {
      lines.push(`    ${ctx.get(service) === undefined ? '缺' : '有'}  ${service}`)
    }
  }

  return lines.join('\n')
}
