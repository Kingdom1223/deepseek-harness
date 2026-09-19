/**
 * 桌面层：窗口外观与桌面交互。
 *
 * 它是一个**自包含的页面脚本**，由 preload 注入执行，不经过官方客户端模块系统。
 *
 * 为什么不用官方模块系统：桌面层要做的事（画标题栏、装快捷键）
 * 全部发生在 DOM 层，而官方模块系统的装载时机由 boot 批次决定，接入点
 * （`__ModuleLoader__.load`）在模块系统进入 live 模式后就关闭了，属于时序竞态。
 * 自己执行就没有这个不确定性，也不影响官方 39 个 UI 插件的装载。
 *
 * 配色完全交给官方 ThemePresenter。桌面层不再覆盖背景 token 或强制深色，保证
 * 首次引导、设置页与网页端使用同一套视觉状态。
 */

;(function installDesktopShell() {
  if (globalThis.__dshDesktopShellInstalled === true) return
  globalThis.__dshDesktopShellInstalled = true

  const bridge = globalThis.dshDesktop
  if (bridge === undefined) {
    console.warn('[desktop-shell] dshDesktop 桥不可用，桌面层跳过')
    return
  }

  const STYLE_ID = 'dshd-chrome'

  /** 注入窗口外观样式。 */
  function ensureChromeStyles() {
    if (document.getElementById(STYLE_ID) !== null) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
:root {
  --dshd-titlebar-height: 38px;
  --dshd-titlebar-blur: 22px;
  --dshd-radius: 8px;
  --dshd-motion: 180ms cubic-bezier(.22,.61,.36,1);
}

/* 无边框窗口的拖拽区：整条标题栏可拖，交互元素除外。 */
.dshd-titlebar {
  position: fixed;
  inset: 0 0 auto 0;
  height: var(--dshd-titlebar-height);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 0 0 14px;
  z-index: 2147483000;
  -webkit-app-region: drag;
  background: color-mix(in oklab, var(--dsw-alias-bg-base, #0b0d12) 74%, transparent);
  backdrop-filter: saturate(140%) blur(var(--dshd-titlebar-blur));
  border-bottom: 1px solid var(--dsw-alias-border-l1, #1e2430);
  user-select: none;
  font-family: var(--dsw-font-family, ui-sans-serif, system-ui, sans-serif);
}
.dshd-titlebar[data-focused="false"] { opacity: .78; }

.dshd-titlebar__mark {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 600; letter-spacing: .02em;
  color: var(--dsw-alias-label-secondary, #a3abbd);
}
.dshd-titlebar__dot {
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--dsw-alias-brand-primary, #8b7cff);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--dsw-alias-brand-primary, #8b7cff) 22%, transparent);
}
.dshd-titlebar__spacer { flex: 1; }

.dshd-actions { display: flex; align-items: center; gap: 2px; -webkit-app-region: no-drag; }
.dshd-btn {
  height: 30px; min-width: 34px; padding: 0 10px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 0; border-radius: 6px;
  color: var(--dsw-alias-label-secondary, #a3abbd);
  font-size: 12px; cursor: pointer;
  transition: background var(--dshd-motion), color var(--dshd-motion);
}
.dshd-btn:hover { background: var(--dsw-alias-interactive-bg-hover, #ffffff14); color: var(--dsw-alias-label-primary, #e8ebf2); }
.dshd-btn--close:hover { background: #e5484d; color: #fff; }

.dshd-update { position: relative; -webkit-app-region: no-drag; }
.dshd-update__button[data-attention="true"] {
  color: var(--dsw-alias-brand-primary, #6750e8);
  background: color-mix(in oklab, var(--dsw-alias-brand-primary, #6750e8) 13%, transparent);
}
.dshd-update__panel {
  position: fixed; top: calc(var(--dshd-titlebar-height) + 8px); right: 12px;
  width: min(340px, calc(100vw - 24px)); padding: 16px;
  display: none; flex-direction: column; gap: 11px;
  background: var(--dsw-alias-bg-elevated, #fff);
  color: var(--dsw-alias-label-primary, #16181d);
  border: 1px solid var(--dsw-alias-border-l1, #dfe2e8);
  border-radius: 12px; box-shadow: 0 18px 50px #0003;
  -webkit-app-region: no-drag;
}
.dshd-update__panel[data-open="true"] { display: flex; }
.dshd-update__title { font-size: 14px; font-weight: 650; }
.dshd-update__status { font-size: 13px; line-height: 1.5; }
.dshd-update__detail { color: var(--dsw-alias-label-secondary, #667085); font-size: 12px; line-height: 1.5; }
.dshd-update__progress { height: 5px; overflow: hidden; border-radius: 99px; background: #8883; }
.dshd-update__progress > span { display: block; height: 100%; background: var(--dsw-alias-brand-primary, #6750e8); transition: width 180ms ease; }
.dshd-update__notes { max-height: 150px; overflow: auto; white-space: pre-wrap; font-size: 12px; line-height: 1.55; }
.dshd-update__options { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--dsw-alias-label-secondary, #667085); }
.dshd-update__channel { margin-left: auto; color: inherit; background: transparent; border: 1px solid #8885; border-radius: 5px; }
.dshd-update__actions { display: flex; justify-content: flex-end; gap: 8px; }
.dshd-update__primary { background: var(--dsw-alias-brand-primary, #6750e8); color: #fff; }
.dshd-update__primary:hover { background: var(--dsw-alias-brand-primary-hover, #5941d7); color: #fff; }

/* 主内容区让出标题栏高度。官方界面是满高的，这里整体下移。 */
#root { padding-top: var(--dshd-titlebar-height); box-sizing: border-box; }
`
    document.head.append(style)
  }

  /** 让 Electron 窗口底色跟随官方 ThemePresenter 的实际结果。 */
  function syncWindowBackground() {
    try {
      const computed = getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim()
      if (computed !== '') bridge.setBackgroundColor?.(computed)
    } catch {
      /* 取值失败不影响页面主题 */
    }
  }

  // ── 标题栏 ───────────────────────────────────────────────────────────────
  function buildTitlebar() {
    const titlebar = document.createElement('div')
    titlebar.className = 'dshd-titlebar'
    titlebar.dataset.focused = 'true'

    const mark = document.createElement('div')
    mark.className = 'dshd-titlebar__mark'
    const dot = document.createElement('span')
    dot.className = 'dshd-titlebar__dot'
    const name = document.createElement('span')
    name.textContent = 'DeepSeek Harness'
    mark.append(dot, name)

    const spacer = document.createElement('div')
    spacer.className = 'dshd-titlebar__spacer'

    const actions = document.createElement('div')
    actions.className = 'dshd-actions'
    actions.append(buildUpdateControl())
    for (const [label, glyph, className, action] of [
      ['最小化', '&#8211;', 'dshd-btn', 'minimize'],
      ['最大化', '&#9723;', 'dshd-btn', 'maximize'],
      ['关闭', '&#10005;', 'dshd-btn dshd-btn--close', 'close'],
    ]) {
      const button = document.createElement('button')
      button.className = className
      button.title = label
      button.setAttribute('aria-label', label)
      button.innerHTML = glyph
      button.addEventListener('click', () => void bridge.window[action]())
      actions.append(button)
    }

    // 双击标题栏切换最大化：Windows 的既有习惯。
    titlebar.addEventListener('dblclick', (event) => {
      if (event.target instanceof Element && event.target.closest('.dshd-actions') !== null) return
      void bridge.window.maximize()
    })

    // 主题选择由官方设置页负责，标题栏只保留窗口控件。
    titlebar.append(mark, spacer, actions)
    document.body.append(titlebar)
    return titlebar
  }

  function formatBytes(value) {
    if (!Number.isFinite(value) || value <= 0) return ''
    const units = ['B', 'KB', 'MB', 'GB']
    let amount = value
    let index = 0
    while (amount >= 1024 && index < units.length - 1) {
      amount /= 1024
      index += 1
    }
    return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
  }

  /** 标题栏更新入口与非技术状态面板。 */
  function buildUpdateControl() {
    const root = document.createElement('div')
    root.className = 'dshd-update'
    const button = document.createElement('button')
    button.className = 'dshd-btn dshd-update__button'
    button.textContent = '更新'
    button.title = '检查应用更新'

    const panel = document.createElement('div')
    panel.className = 'dshd-update__panel'
    panel.dataset.open = 'false'
    const title = document.createElement('div')
    title.className = 'dshd-update__title'
    title.textContent = '应用更新'
    const status = document.createElement('div')
    status.className = 'dshd-update__status'
    const detail = document.createElement('div')
    detail.className = 'dshd-update__detail'
    const progress = document.createElement('div')
    progress.className = 'dshd-update__progress'
    const progressBar = document.createElement('span')
    progress.append(progressBar)
    const notes = document.createElement('div')
    notes.className = 'dshd-update__notes'

    const options = document.createElement('label')
    options.className = 'dshd-update__options'
    const autoCheck = document.createElement('input')
    autoCheck.type = 'checkbox'
    const autoLabel = document.createElement('span')
    autoLabel.textContent = '启动后自动检查更新'
    const channel = document.createElement('select')
    channel.className = 'dshd-update__channel'
    for (const [value, label] of [['stable', '正式版'], ['beta', '测试版']]) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      channel.append(option)
    }
    options.append(autoCheck, autoLabel, channel)

    const actionRow = document.createElement('div')
    actionRow.className = 'dshd-update__actions'
    const release = document.createElement('button')
    release.className = 'dshd-btn'
    release.textContent = '发布页面'
    const primary = document.createElement('button')
    primary.className = 'dshd-btn dshd-update__primary'
    actionRow.append(release, primary)
    panel.append(title, status, detail, progress, notes, options, actionRow)
    root.append(button, panel)

    let state
    const render = (next) => {
      state = next
      if (state === undefined) return
      const version = state.availableVersion === null ? '' : ` v${state.availableVersion}`
      const copy = {
        disabled: [state.reason ?? '此版本暂不支持在线更新', '不可用'],
        idle: [`当前版本 v${state.currentVersion}`, '检查更新'],
        checking: ['正在检查新版本…', '检查中…'],
        available: [`发现新版本${version}`, '下载更新'],
        'not-available': [`已经是最新版 v${state.currentVersion}`, '再次检查'],
        downloading: [`正在下载${version}`, `${Math.round(state.progress ?? 0)}%`],
        downloaded: [`新版本${version}已准备好`, '重启并安装'],
        installing: ['正在退出并安装更新…', '安装中…'],
        error: ['更新失败', '重试'],
      }[state.phase] ?? ['更新状态未知', '检查更新']
      status.textContent = copy[0]
      primary.textContent = copy[1]
      detail.textContent = state.error ?? (
        state.phase === 'downloading'
          ? `${formatBytes(state.transferred)} / ${formatBytes(state.total)}`
          : `更新通道：${state.channel === 'beta' ? '测试版' : '正式版'}`
      )
      progress.hidden = state.phase !== 'downloading'
      progressBar.style.width = `${Math.round(state.progress ?? 0)}%`
      notes.textContent = state.releaseNotes ?? ''
      notes.hidden = notes.textContent === ''
      release.hidden = state.releaseUrl === null
      primary.disabled = ['checking', 'downloading', 'installing', 'disabled'].includes(state.phase)
      channel.value = state.channel
      channel.disabled = ['checking', 'downloading', 'downloaded', 'installing', 'disabled'].includes(state.phase)
      button.dataset.attention = String(['available', 'downloaded'].includes(state.phase))
      button.textContent = state.phase === 'downloaded' ? '重启更新' : state.phase === 'downloading' ? `${Math.round(state.progress ?? 0)}%` : '更新'
    }

    button.addEventListener('click', async () => {
      panel.dataset.open = String(panel.dataset.open !== 'true')
      if (panel.dataset.open === 'true') render(await bridge.update.getState())
    })
    primary.addEventListener('click', async () => {
      if (state?.phase === 'available') render(await bridge.update.download())
      else if (state?.phase === 'downloaded') render(await bridge.update.install())
      else render(await bridge.update.check())
    })
    release.addEventListener('click', () => {
      if (state?.releaseUrl !== null) void bridge.app.openExternal(state.releaseUrl)
    })
    autoCheck.addEventListener('change', () => void bridge.store.set('updates.autoCheck', autoCheck.checked))
    channel.addEventListener('change', async () => render(await bridge.update.setChannel(channel.value)))
    void bridge.store.get('updates.autoCheck', true).then((value) => { autoCheck.checked = value === true })
    void bridge.update.getState().then(render)
    bridge.update.onState(render)
    document.addEventListener('pointerdown', (event) => {
      if (panel.dataset.open === 'true' && !root.contains(event.target)) panel.dataset.open = 'false'
    })
    return root
  }

  // ── 装载 ─────────────────────────────────────────────────────────────────
  ensureChromeStyles()
  const titlebar = buildTitlebar()
  syncWindowBackground()

  // 官方 presenter 异步写 body 属性和 token；监听它而不覆盖它。
  new MutationObserver(syncWindowBackground).observe(document.body, {
    attributes: true,
    attributeFilter: ['style', 'data-ds-dark-theme'],
  })

  bridge.window.onState((state) => {
    titlebar.dataset.focused = String(state.focused)
  })

  bridge.onCommand(({ channel }) => {
    switch (channel) {
      case 'app.openDataDir':
        void bridge.app.openDataDir()
        return
      default:
        return
    }
  })

  console.log(
    `[desktop-shell] 已装载：主题=official 标题栏=${titlebar !== undefined ? 'ok' : '缺失'}` +
      ` body属性=${document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'}`,
  )
})()
