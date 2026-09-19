# DeepSeek Harness 桌面版

把 DeepSeek Harness 从网页端做成真正的桌面应用：**在 Electron 主进程里直接运行 DSH 运行时**，
渲染进程不连 localhost、不发任何网络请求，全部通信走 IPC。

---

## 它和「网页套壳」的区别

| | 网页套壳 | 本项目 |
|---|---|---|
| 运行时 | 用户自己开 `dsh web`，壳去连 URL | Electron 主进程内**直接挂载 Cordis 树** |
| 页面来源 | `http://localhost:3080` | 自定义协议 `app://shell` |
| 网络出口 | 渲染进程随便请求 | **零出口**，非 `file://`/`app://` 请求一律拦截 |
| API 通道 | HTTP + WebSocket | IPC 进程内直调 + 主进程持有 WebSocket |
| 插件包 | HTTP 取 | IPC 读磁盘字节 |
| 窗口 | 浏览器窗口 | 无边框自绘标题栏 + 原生菜单/托盘 |
| 启动 | 开终端跑命令 | 双击图标 |

关键点：它不是把浏览器窗口藏起来，而是**用官方公开的接缝把整个传输层换掉**。

---

## 架构

```
Electron 主进程
├── runtime.js        进程内挂载 DSH Cordis 树
│                     · 解析 desktop profile（dsh-base + dsh-web-app）
│                     · 压平 patch 层 → 官方 mountRootInclude 挂树
│                     · 提供宿主服务：dshHomePath / appExit / cmdlineArgs / webStartup
│                     · 刻意不提供 appReady（会形成「自己等自己」的死锁）
├── page-protocol.js  app:// 协议：复刻官方取页路径
│                     · 调 webServer.renderIndex() 拿到完整引导注入
│                     · 还原官方把 & 转义成 &amp; 导致的 rev 参数失效
├── transport.js      传输层宿主侧
│                     · 按载具形态分三类分发：精确路由 / 共享通道 / RPC 通道
│                     · 认证复用官方「进程令牌换签名 cookie」
│                     · 物理 WebSocket 归主进程，帧经 IPC 双向搬运
├── mount.js          组装 Cordis 树
├── native.js         应用菜单 + 托盘
└── store.js          桌面偏好（窗口几何等）

preload（与页面共享全局，这是官方载具接缝的前提）
├── __DSH_TRANSPORT__ = { fetch, openStream, loadBundle, ownsHost: true }
├── __ModuleLoader__ 门面 + __DSH_BOOT__ 模块图（内联脚本在自定义协议下不执行，改由这里注入）
├── 引导批次（client-modules）自己装载
└── WebSocket 接管（页面拿不到同源 WebSocket，物理连接仍在主进程）

桌面层（src/desktop/desktop-shell.js，普通页面脚本）
├── 无边框自绘标题栏 + 窗口控件
└── 跟随官方 ThemePresenter，不覆盖网页端背景与配色 token
```

### 为什么必须关闭 `contextIsolation`

官方为「自带物理载具的外壳」预留的接缝是 `globalThis.__DSH_TRANSPORT__`。
preload 跑在隔离世界里的话，它设的全局变量页面读不到，接缝静默失效——
症状就是 shell 报 `bootstrap facade is missing`，界面永远出不来。

代价由设计补回来：页面源码逐字节来自本机 `app://` 通道；渲染进程没有网络出口；
未开启 `nodeIntegration`；需要原生的能力一律经 preload 的窄接口转发。

## 运行与安装

### Windows x64 安装器（推荐）

运行 `dist/DeepSeek-Harness-Setup-<version>.exe`。安装器按当前用户安装，不需要管理员权限，
并创建桌面和开始菜单快捷方式。应用数据在卸载时默认保留，方便覆盖升级。

发布前必须在没有安装正式版的干净 Windows 用户、CI 或虚拟机中执行
`npm run release:win`。该命令会检查依赖版本、运行单元测试和 Electron 底层自检、
生成安装器，再在独立临时目录完成一次“安装 → 发布态自检 → 卸载”闭环。NSIS 可能把
同一用户下的临时安装识别成升级；门禁检测到现有安装时会主动停止，避免覆盖用户版本。

原先安装器卡住的根因是关闭 ASAR 后需要逐个写入 1.6 万多个小文件。当前只解包原生模块，
发布目录已降到约 140 个文件；安装器端到端门禁会阻止这个问题再次进入发布包。

### 开发态直接跑

```powershell
npm install     # 首次需要，会下载 Electron 与 DSH 全量插件
npm start
```

### 单独打包或检查

```powershell
npm run pack:dir          # 生成 win-unpacked 目录
npm run test:packaged     # 检查目录发布包
npm run build:win         # 生成 Windows x64 NSIS 安装器
npm run test:installer    # 干净 Windows 用户/CI/VM：临时安装、运行自检、卸载并清理
```

当前发布目标是 **Windows 10/11 x64**。ARM64、macOS 和 Linux 尚未配置对应原生依赖和安装包，
不能宣称已支持。

---

## 升级接口

升级 DSH 时使用以下固定流程，避免 RC 版本混装或 Profile 引用缺包：

```powershell
npm install @deepseek-ai/dsh@<exact-version> --save-exact
npm run deps:sync
npm install
npm run release:win
```

`npm run deps:sync` 会把 DSH、Profile 兼容包和 Cordis 依赖同步到 `package.json`；
`npm run deps:check` 会同时校验清单、实际安装版本和缺失包。安装包版本来自 `package.json`，
安装自检不再写死版本号。

### 通过 GitHub Releases 自动更新

桌面端的更新能力使用 `electron-updater`，GitHub Releases 同时承担版本清单和安装包托管，
不需要额外服务器。运行时只公开稳定的 `getState / check / download / install / setChannel`
接口；GitHub provider 被限制在主进程内，渲染进程拿不到 Token 或下载路径。

发布步骤：

1. 修改 `package.json` 的版本，例如 `0.1.0` → `0.1.1`。
2. 提交后创建同名 Tag：`v0.1.1`。
3. 推送 Tag。`.github/workflows/release.yml` 会自动检查、构建、验证并创建 Release。

GitHub Actions 会从 `${{ github.repository }}` 自动注入 `owner/repo`，源码里的
`resources/update-config.json` 可以保持空值。Release 最终必须同时包含：

```text
latest.yml（预发布版本为 beta.yml）
DeepSeek-Harness-Setup-<version>.exe
DeepSeek-Harness-Setup-<version>.exe.blockmap
```

本地模拟 GitHub 发布构建：

```powershell
$env:DSH_GITHUB_REPOSITORY = 'owner/repo'
npm run build:release:github
npm run update:artifacts:check
```

正式签名时，在 GitHub 仓库 Secrets 配置 `CSC_LINK` 和 `CSC_KEY_PASSWORD`。工作流不会
把凭据写入配置或安装包；未提供证书时仍能生成 Release，但会明确警告 SmartScreen 风险。
正式版使用 `latest.yml`，带预发布后缀的版本（如 `0.2.0-beta.1`）使用 `beta.yml`。
用户可在标题栏更新面板切换正式版/测试版通道。

---

## 自检工具

| 脚本 | 用途 |
|---|---|
| `node scripts/verify-profile.mjs` | 纯 Node 验证 profile 组合（不解锁 Electron 就能查装配问题） |
| `node scripts/repair-deps.mjs` | 从实际 import 反推缺失依赖（DSH 有一批包没在 package.json 里声明） |
| `node scripts/sync-deps.mjs` | 把 DSH 声明的全部同系列包对齐进本项目 |
| `node scripts/dump-entries.mjs [关键字]` | 打印组合后的条目树 |
| `node scripts/make-icons.mjs` | 从 SVG 重新生成全套图标 |

常用门禁：`npm run deps:check`、`npm test`、`npm run profile:check`、
`npm run test:electron`、`npm run test:packaged`、`npm run test:installer`。

启动追踪写在 `%APPDATA%\DeepSeek Harness\startup.log`，
引导页面快照在 `%APPDATA%\DeepSeek Harness\boot-page.html`——这两个文件是排障的主要入口。

---

## 已知取舍

- **依赖 DSH 未声明的兄弟包**：`dsh-fs-local` 用 `dsh-fs`、`dsh-agent-loop` 用
  `dsh-session-persistence` 这类 import 没有写进任何 package.json，靠 pnpm 的扁平布局
  恰好存在。换到 npm 树就会缺，所以用 `repair-deps.mjs` 从实际 import 反推补齐。
- **遥测已关闭**：profile 层禁用 `session-telemetry-otel`，并设 `DSH_TELEMETRY_DISABLED`。
- **关闭 `contextIsolation`**：见上文，是官方载具接缝的前提。
- **端口是随机回环端口**：`127.0.0.1:0`，只服务主进程自己的事件流，外部不可达，用户无需知道。
- **ASAR 只解包原生组件**：JavaScript 和普通资源进入 `app.asar`，`node-pty`、`sharp`、
  `koffi`、ripgrep 等需要系统直接加载或执行的组件由 `asarUnpack` 保留在外部。
  发布态自检覆盖这些原生模块和客户端模块图，防止目录布局回归。
- **`npmRebuild: false`**：`node-pty` 的原生重建需要 Visual Studio，而预编译二进制
  在 Electron 44 下实测可用，所以跳过重建。
- **尚未配置代码签名**：没有证书的安装器会触发 Windows SmartScreen 提示。正式公开分发前，
  通过 electron-builder 标准的 `CSC_LINK` / `CSC_KEY_PASSWORD` 环境变量接入证书，禁止把证书写进仓库。
