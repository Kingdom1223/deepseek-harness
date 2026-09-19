/**
 * 原生桌面面：应用菜单、托盘、系统集成。
 *
 * 这些是「桌面版」与「网页版」在体验上最直接的差别之一：网页版没有菜单栏，
 * 没有托盘，也不会在任务完成时从系统层面提醒你。
 */
import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import { resourcesDir } from './paths.js'

/** @type {Tray | undefined} */
let tray

/**
 * 打开或聚焦主窗口。
 * @param {import('electron').BrowserWindow | undefined} window - 主窗口
 */
function focusWindow(window) {
  if (window === undefined) return
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
}

/**
 * 安装应用菜单。菜单项通过 webContents 发送语义化命令，由渲染进程的桌面层
 * 决定如何响应——主进程不假设界面结构。
 * @param {{window?: import('electron').BrowserWindow, store: import('./store.js').DesktopStore, isDev: boolean, onCheckForUpdates?: () => unknown}} options
 */
export function installApplicationMenu(options) {
  const { window, store } = options
  /** 把命令发给渲染进程的桌面层。 */
  const send = (channel, payload) => {
    focusWindow(window)
    window?.webContents.send('dsh:command', { channel, payload })
  }

  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '新建会话', accelerator: 'CmdOrCtrl+N', click: () => send('session.new') },
        { label: '打开工作区…', accelerator: 'CmdOrCtrl+O', click: () => send('workspace.open') },
        { type: 'separator' },
        { label: '导出会话…', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('session.export') },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '指令中枢', accelerator: 'CmdOrCtrl+K', click: () => send('palette.toggle') },
        { label: '切换右侧面板', accelerator: 'CmdOrCtrl+B', click: () => send('panel.toggle') },
        { label: '紧凑密度', click: () => send('density.toggle') },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { role: 'reload', label: '重新载入' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { label: '置顶', type: 'checkbox', click: (item) => window?.setAlwaysOnTop(item.checked) },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '检查更新…', click: () => options.onCheckForUpdates?.() },
        { type: 'separator' },
        { label: '打开数据目录', click: () => send('app.openDataDir') },
        {
          label: '开发者工具',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => window?.webContents.toggleDevTools(),
        },
        { type: 'separator' },
        {
          label: `版本 ${app.getVersion()}`,
          enabled: false,
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * 安装托盘图标与菜单。
 * @param {{window?: import('electron').BrowserWindow, store: import('./store.js').DesktopStore, isDev: boolean}} options
 */
export function installTray(options) {
  const { window } = options
  const iconPath = join(resourcesDir(), 'icons', 'tray.png')
  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    // 没有图标资源时静默跳过：托盘是增强，不是启动前提。
    return
  }
  tray = new Tray(image.resize({ width: 16, height: 16 }))
  tray.setToolTip('DeepSeek Harness')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => focusWindow(window) },
      { label: '新建会话', click: () => window?.webContents.send('dsh:command', { channel: 'session.new' }) },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]),
  )
  tray.on('click', () => focusWindow(window))
}

/** 释放托盘。 */
export function disposeTray() {
  tray?.destroy()
  tray = undefined
}
