/**
 * 窗口控件：把最大化/全屏状态推给渲染进程，让自绘标题栏能反映真实状态。
 *
 * 自绘标题栏最容易出错的地方是「状态漂移」——用户用 Win+↑ 或双击标题栏最大化，
 * 渲染进程不知道。所以所有状态变化都由主进程广播，而不是渲染进程自己猜。
 */

/**
 * @param {import('electron').BrowserWindow} window - 主窗口
 * @param {import('./store.js').DesktopStore} store - 桌面设置
 */
export function attachWindowControls(window, store) {
  /** 把当前窗口状态发给渲染进程。 */
  const publish = () => {
    if (window.isDestroyed()) return
    window.webContents.send('dsh:window:state', {
      maximized: window.isMaximized(),
      fullscreen: window.isFullScreen(),
      focused: window.isFocused(),
    })
  }

  for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur', 'restore']) {
    window.on(event, publish)
  }

  // 记住窗口几何，下次启动原样恢复。
  let saveTimer
  const persistGeometry = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (window.isDestroyed()) return
      void store.merge({
        'window.maximized': window.isMaximized(),
        ...window.isMaximized() || window.isFullScreen()
          ? {}
          : { 'window.width': window.getSize()[0], 'window.height': window.getSize()[1] },
      })
    }, 400)
  }
  window.on('resize', persistGeometry)
  window.on('move', persistGeometry)

  window.webContents.once('did-finish-load', publish)

  // Windows 下无边框窗口的拖拽缩放：Electron 对 frameless 仍保留边缘热区，
  // 但标题栏的拖拽区域必须由渲染进程用 -webkit-app-region 声明。
  window.on('closed', () => clearTimeout(saveTimer))
}
