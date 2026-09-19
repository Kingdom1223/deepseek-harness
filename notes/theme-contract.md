# DeepSeek Harness Web GUI —— 主题契约与布局契约（从已构建产物中考古提取）

> 提取对象：`C:\Users\w-king\AppData\Local\npm-cache\_npx\1e7f6d9597241db0\node_modules\@deepseek-ai\`
> 提取方式：只读。`lib/types/**/*.d.ts` 建立名词表 → 回混淆 `lib/*.js` 反查实现 → 反解内嵌 CSS 字符串与 class map。
> 报告内所有值均为**产物中实际存在的字面量**；推不出的地方明确写「未找到」。

---

## 0. 先修正三个前提（重要，会改变你写 CSS 的方式）

| 任务假设 | 产物中的事实 |
|---|---|
| 变量前缀是 `--dsh-*` | **主色板前缀是 `--dsw-*`**（Design System Web）。`--dsh-*` 是**应用层/harness 层**变量，数量少（约 40 个），且大多数是「布局尺寸」而非颜色。另有三族：`--ds-*`（基础字体/动效）、`--dsl-*`（工具视图代码块）、`--shiki-*`/`--json-tree-*`/`--dsh-boot-*`。 |
| `dsh-client-ui-primitives` 是关键包 | **该目录在本树中不存在**。它与 `dsh-client-ui-dockkit`、`dsh-client-store`、`dsh-client-ui-slots` 一样，被**打进 Web shell bundle**（`dsh-web-frontend/dist/assets/index-DuF6ti6g.js` + `index-DPX2bQLO.css`），以 `require("@deepseek-ai/dsh-client-ui-primitives")` 的形式被各 client 插件引用。它的 CSS 类名因此**也在 dist CSS 里**（见 §2.2）。 |
| 明暗切换用 `data-theme` | **全树 grep `data-theme` 结果为 0 次命中**。实际机制是 `body[data-ds-dark-theme]` 属性 + `html { color-scheme }`，见 §1.15。 |

另外两个会影响阅读的事实：

- `dsh-client-ui-settings` **没有任何 CSS / DOM / React**，它是纯 headless service（`ctx.settingsScope`）。设置面板的 DOM 在 `dsh-client-ui-settings-general`。
- 输入框/作曲区（composer）**不在** `dsh-client-ui-chat`，而在 `dsh-client-ui-conversation` 的 `InputBar.module.css`。`ui-chat` 只提供消息流与 markdown。

---

## 1. CSS 自定义属性（变量）清单

### 1.1 命名家族总览

| 前缀 | 家族含义 | 声明位置 | 数量（本树统计） |
|---|---|---|---|
| `--ds-*` | 基础：字体栈、缓动、动效时长 | `:root`（theme base.css） | 5 |
| `--dsw-static-*` | 静态色板（永不随明暗变化，**1 个例外**） | `body`（theme design-platform.css） | 73 |
| `--dsw-alias-*` | 语义别名（**明暗各一套**） | `body` / `body[data-ds-dark-theme]` | 79 |
| `--dsw-specific-*` | 产品专有语义（气泡/侧栏/菜单等），与 alias 同规则同批次声明 | 同上 | 11 |
| `--dsw-font-*` | 字体阶梯（复合简写 + 拆分子属性） | `body`（theme gradient-shadow-text.css） | 181 |
| `--dsw-shadow-lv*` / `--dsw-elevation-*` / `--dsw-linear-*` / `--dsw-mask-blur` / `--dsw-corner-shape` | 阴影、高度、渐变、模糊、超椭圆圆角 | 同上 / corner-shape.css / 组件 | 13 |
| `--dsh-*` | 应用层：滚动条、会话内容字号、composer 尺寸、侧栏内边距 | 各 client 插件 | 40（见 §1.10） |
| `--dsl-*` | 工具视图（代码块/diff/read/search/terminal/web）几何 | 工具视图 CSS module | 17 |
| `--shiki-*` | 语法高亮 token 色 | `:root` / `body[data-ds-dark-theme]` | 22 |
| `--json-tree-*` | JSON 树查看器 | `._root_4qrvp_1` / dark 覆盖 | 7 |
| `--dsh-boot-*` | 首屏加载页 | `._boot_1fywu_3` / dark 覆盖 | 6 |
| `--turn-rail-band` / `--turn-preview-height` | 轮次导航轨 | ui-chat TurnNavigator | 2 |

**`--dsw-*` 一族在 `dsh-client-ui-theme/lib/client.js` 内共 357 个唯一名**（73 static + 79 alias + 11 specific + 181 font + 13 其它）；把各插件与 dist CSS 一起算，全树声明去重后 **358 个**，被 `var()` 实际引用 **165 个**。

### 1.2 声明位置与注入方式（决定你的 CSS 该放哪、优先级怎么排）

主题的 6 张样式表**不是** dist CSS 的一部分，而是编译成字符串常量内嵌在 `dsh-client-ui-theme/lib/client.js` 里，由插件在运行时注入 `document.head`：

```js
// dsh-client-ui-theme/lib/client.js:1066
const STYLES = [["base.css", base_css_default], ["corner-shape.css", corner_shape_css_default],
  ["design-platform.css", design_platform_css_default], ["scrollbar.css", scrollbar_css_default],
  ["gradient-shadow-text.css", gradient_shadow_text_css_default], ["shiki.css", shiki_css_default]];
// :1080
const tag = document.createElement("style");
tag.dataset.plugin = PLUGIN_ID;                       // "@deepseek-ai/dsh-client-ui-theme"
tag.dataset.pluginCss = `${PLUGIN_ID}/${name}`;       // 例："@deepseek-ai/dsh-client-ui-theme/base.css"
document.head.appendChild(tag);
```

所以 DOM 里会出现 6 个可精确命中的节点：

```html
<style data-plugin="@deepseek-ai/dsh-client-ui-theme"
       data-plugin-css="@deepseek-ai/dsh-client-ui-theme/design-platform.css">…</style>
```

其它包用自己的 CSS module 各注入一个 `<style data-plugin-css="<pkg>/<File>.module.css">`（每个包注入前会 `document.querySelector("style[data-plugin-css=...]")` 去重）。

**对你的影响：**

- 主题变量的声明位于 `<style>` 元素，选择器权重是 `body`（0,0,1）与 `body[data-ds-dark-theme]`（0,1,1）。你在自己样式表里写 `:root{...}` 权重低于 `body`，会被覆盖；**用 `body` 或更高权重覆盖最稳**。
- 多个包在各自容器上做「滚动条重绑定」：`--dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2)`。任何 l2 抬升面（菜单/弹层/对话框/审批卡/composer）都会重绑一次。你覆写 `--dsh-scrollbar-thumb` 时要注意这些局部重绑。

### 1.3 `--ds-*` 基础（`:root`，theme `base.css` 全文）

```css
:root{
  --dsw-font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
  --ds-font-family-code:"SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei";
  --ds-ease-in-out:cubic-bezier(.4, 0, .2, 1);
  --ds-transition-duration:.2s;
  --ds-transition-duration-fast:.1s;
  --ds-transition-duration-slow:.3s;
}
```

来源：`dsh-client-ui-theme/lib/client.js:1047`（`\0dsh-inline-css:…/src/styles/base.css.mjs`），原始片段：
`var base_css_default = ":root{--dsw-font-family:-apple-system, BlinkMacSystemFont, \"Segoe UI\", …--ds-transition-duration-slow:.3s}";`

注意 `--dsw-font-family` 与 `--ds-font-family-code` 同住在 `:root` —— **唯一的两个字体栈变量**（外加一个从未声明的 `--dsh-font-mono`，见 §1.10）。

### 1.4 `--dsw-static-*` 静态色板（73 个，light/dark 完全同值，只有 1 个例外）

声明在 theme `design-platform.css` 的第一条 `body{}` 与 `body[data-ds-dark-theme]{}` 中。

**唯一明暗不同的静态色：**

| 变量 | light | dark |
|---|---|---|
| `--dsw-static-neutral-bluish-60` | `#f5f6f7` | `#f9fafb` |

其余 72 个完全同值：

| 变量 | 值 | 变量 | 值 |
|---|---|---|---|
| `--dsw-static-amber-100` | `#fef5e7` | `--dsw-static-neutral-00` | `#fff` |
| `--dsw-static-amber-400` | `#f7ad31` | `--dsw-static-neutral-50` | `#fafafa` |
| `--dsw-static-amber-500` | `#f59e0b` | `--dsw-static-neutral-100` | `#f5f5f5` |
| `--dsw-static-amber-600` | `#dd8629` | `--dsw-static-neutral-150` | `#ededed` |
| `--dsw-static-amber-900` | `#27241f` | `--dsw-static-neutral-200` | `#e5e5e5` |
| `--dsw-static-blue-50` | `#eff6ff` | `--dsw-static-neutral-250` | `#dcdcdc` |
| `--dsw-static-blue-50p` | `#eaf3ff` | `--dsw-static-neutral-300` | `#d4d4d4` |
| `--dsw-static-blue-75` | `#e5f0ff` | `--dsw-static-neutral-400` | `#a2a4a6` |
| `--dsw-static-blue-100` | `#dbeafe` | `--dsw-static-neutral-500` | `#7f8287` |
| `--dsw-static-blue-300` | `#93c5fd` | `--dsw-static-neutral-550` | `#65676b` |
| `--dsw-static-blue-400` | `#60a5fa` | `--dsw-static-neutral-600` | `#545557` |
| `--dsw-static-blue-450` | `#4d93f8` | `--dsw-static-neutral-700` | `#3c3c3d` |
| `--dsw-static-blue-500` | `#3b82f6` | `--dsw-static-neutral-800` | `#292929` |
| `--dsw-static-blue-600` | `#2563eb` | `--dsw-static-neutral-850` | `#212123` |
| `--dsw-static-blue-800` | `#1e40af` | `--dsw-static-neutral-900` | `#0f0f0f` |
| `--dsw-static-blue-900` | `#0e3074` | `--dsw-static-neutral-1000` | `#000` |
| `--dsw-static-blue-950` | `#172554` | `--dsw-static-neutral-bluish-00` | `#fff` |
| `--dsw-static-deepseek-50` | `#edf3fe` | `--dsw-static-neutral-bluish-50` | `#f9fafb` |
| `--dsw-static-deepseek-100` | `#e4edfd` | `--dsw-static-neutral-bluish-75` | `#f1f3f5` |
| `--dsw-static-deepseek-200` | `#d3e2ff` | `--dsw-static-neutral-bluish-100` | `#ebeef2` |
| `--dsw-static-deepseek-300` | `#b7c8fe` | `--dsw-static-neutral-bluish-150` | `#e9ecf2` |
| `--dsw-static-deepseek-400` | `#679efe` | `--dsw-static-neutral-bluish-200` | `#e1e5ee` |
| `--dsw-static-deepseek-450` | `#5686fe` | `--dsw-static-neutral-bluish-300` | `#cfd3d6` |
| `--dsw-static-deepseek-500` | `#4176e6` | `--dsw-static-neutral-bluish-400` | `#adb2b8` |
| `--dsw-static-deepseek-600` | `#4868b2` | `--dsw-static-neutral-bluish-500` | `#979da6` |
| `--dsw-static-deepseek-700-delete` | `#2f4c8f` | `--dsw-static-neutral-bluish-600` | `#81858c` |
| `--dsw-static-deepseek-800` | `#34415b` | `--dsw-static-neutral-bluish-700` | `#61666b` |
| `--dsw-static-deepseek-900` | `#283142` | `--dsw-static-neutral-bluish-750` | `#43454a` |
| `--dsw-static-green-100` | `#e6faed` | `--dsw-static-neutral-bluish-800` | `#353638` |
| `--dsw-static-green-400` | `#4ed17e` | `--dsw-static-neutral-bluish-850` | `#2c2c2e` |
| `--dsw-static-green-500` | `#22c55e` | `--dsw-static-neutral-bluish-875` | `#232324` |
| `--dsw-static-green-900` | `#233c2c` | `--dsw-static-neutral-bluish-900` | `#1b1b1c` |
| `--dsw-static-red-50` | `#fef2f2` | `--dsw-static-neutral-bluish-950` | `#151517` |
| `--dsw-static-red-100` | `#fee2e2` | `--dsw-static-neutral-bluish-1000` | `#0f1115` |
| `--dsw-static-red-400` | `#f25a5a` | | |
| `--dsw-static-red-500` | `#ef4444` | | |
| `--dsw-static-red-600` | `#ec1313` | | |
| `--dsw-static-red-900` | `#570c0c` | | |

> 注意 `--dsw-static-deepseek-700-delete` 名字里带 `-delete`，这是产物里的真实变量名（疑似设计系统里被标记删除、但仍被声明）。

### 1.5 `--dsw-alias-*` 语义别名（79 个）+ `--dsw-specific-*`（11 个），完整 light/dark 对照表

这是**你写自定义 CSS 时最该动的层**。全部声明在 theme `design-platform.css` 的 `body{}` 与 `body[data-ds-dark-theme]{}` 中（两组各 90 条，别名与 specific 同批次）。

| 变量 | light | dark |
|---|---|---|
| `--dsw-alias-bg-base` | `var(--dsw-static-neutral-bluish-00)` | `var(--dsw-static-neutral-bluish-950)` |
| `--dsw-alias-bg-layer-1` | `var(--dsw-static-neutral-bluish-00)` | `var(--dsw-static-neutral-bluish-875)` |
| `--dsw-alias-bg-layer-2` | `var(--dsw-static-neutral-bluish-00)` | `var(--dsw-static-neutral-bluish-850)` |
| `--dsw-alias-bg-layer-3` | `var(--dsw-static-neutral-bluish-00)` | `var(--dsw-static-neutral-bluish-800)` |
| `--dsw-alias-bg-mask-1` | `#0000003d` | `#00000080` |
| `--dsw-alias-bg-mask-2` | `#0000001f` | `#0003` |
| `--dsw-alias-bg-mask-3` | `#0000007a` | `#0000007a` |
| `--dsw-alias-bg-mask-photo` | `#000000e0` | `#000000e0` |
| `--dsw-alias-bg-mask-drop` | `#ffffffb3` | `#272730b3` |
| `--dsw-alias-bg-module-platform` | `var(--dsw-static-neutral-bluish-60)` | `var(--dsw-static-neutral-bluish-800)` |
| `--dsw-alias-bg-multi-select` | `var(--dsw-static-neutral-bluish-60)` | `var(--dsw-static-neutral-850)` |
| `--dsw-alias-bg-overlay` | `var(--dsw-static-neutral-bluish-150)` | `var(--dsw-static-neutral-bluish-700)` |
| `--dsw-alias-bg-skeleton` | `#0000000a` | `#ffffff14` |
| `--dsw-alias-border-inverted` | `#0000` | `#ffffff0f` |
| `--dsw-alias-border-inverted2` | `#0000` | `#ffffff14` |
| `--dsw-alias-border-l1` | `#0000000a` | `#ffffff0f` |
| `--dsw-alias-border-l2` | `#0000001a` | `#ffffff1f` |
| `--dsw-alias-border-l2-darkmode-thin` | `#0000001a` | `#ffffff0f` |
| `--dsw-alias-border-l3` | `#0000001f` | `#ffffff29` |
| `--dsw-alias-border-l4` | `#00000029` | `#fff3` |
| `--dsw-alias-brand-primary` | `var(--dsw-static-neutral-bluish-1000)` | `var(--dsw-static-neutral-bluish-50)` |
| `--dsw-alias-brand-primary-invert` | `var(--dsw-static-neutral-bluish-1000)` | `var(--dsw-static-neutral-bluish-50)` |
| `--dsw-alias-brand-primary-new-colorprimary-new-color` | `#4176e6` | `var(--dsw-static-deepseek-450)` |
| `--dsw-alias-brand-text` | `var(--dsw-static-neutral-bluish-1000)` | `var(--dsw-static-neutral-bluish-50)` |
| `--dsw-alias-button-contrast-fill` | `var(--dsw-static-neutral-bluish-700)` | `var(--dsw-static-neutral-bluish-50)` |
| `--dsw-alias-button-elevated-fill` | `var(--dsw-static-neutral-bluish-00)` | `var(--dsw-static-neutral-bluish-750)` |
| `--dsw-alias-button-floating-fill` | `var(--dsw-static-neutral-bluish-00)` | `var(--dsw-static-neutral-bluish-850)` |
| `--dsw-alias-button-floating-hover` | `var(--dsw-static-neutral-bluish-75)` | `var(--dsw-static-neutral-bluish-800)` |
| `--dsw-alias-button-ghost-active-border` | `var(--dsw-static-neutral-bluish-500)` | `var(--dsw-static-neutral-bluish-600)` |
| `--dsw-alias-button-ghost-active-fill` | `var(--dsw-static-neutral-bluish-100)` | `var(--dsw-static-neutral-bluish-750)` |
| `--dsw-alias-button-ghost-active-hover` | `var(--dsw-static-neutral-bluish-150)` | `var(--dsw-static-neutral-bluish-700)` |
| `--dsw-alias-button-info-fill` | `var(--dsw-static-deepseek-500)` | `var(--dsw-static-deepseek-400)` |
| `--dsw-alias-button-info-hover` | `var(--dsw-static-deepseek-400)` | `var(--dsw-static-deepseek-500)` |
| `--dsw-alias-button-primary-dimmed` | `var(--dsw-static-neutral-bluish-100)` | `var(--dsw-static-neutral-bluish-750)` |
| `--dsw-alias-button-primary-fill` | `var(--dsw-alias-brand-primary)` | `var(--dsw-alias-brand-primary)` |
| `--dsw-alias-button-primary-hover` | `var(--dsw-static-neutral-bluish-750)` | `var(--dsw-static-neutral-bluish-100)` |
| `--dsw-alias-button-tool-bar-fill` | `#54555780` | `#54555780` |
| `--dsw-alias-button-tool-bar-fill-invisible` | `#1f1f1f5c` | `#1f1f1f5c` |
| `--dsw-alias-button-tool-bar-hover` | `#54555799` | `#54555799` |
| `--dsw-alias-interactive-bg-active` | `#2631481a` | `#ffffff24` |
| `--dsw-alias-interactive-bg-hover` | `#2631480f` | `#ffffff14` |
| `--dsw-alias-interactive-bg-hover-accent` | `#26314824` | `#ffffff3d` |
| `--dsw-alias-interactive-bg-hover-danger` | `#ec13130d` | `#f25a5a26` |
| `--dsw-alias-interactive-bg-hover-solid` | `var(--dsw-static-neutral-bluish-75)` | `var(--dsw-static-neutral-bluish-800)` |
| `--dsw-alias-label-caption` | `var(--dsw-static-neutral-bluish-400)` | `var(--dsw-static-neutral-bluish-600)` |
| `--dsw-alias-label-dimmed` | `var(--dsw-static-neutral-bluish-200)` | `var(--dsw-static-neutral-bluish-750)` |
| `--dsw-alias-label-primary` | `var(--dsw-static-neutral-bluish-1000)` | `var(--dsw-static-neutral-bluish-50)` |
| `--dsw-alias-label-primary-bluish` | `var(--dsw-static-blue-900)` | `var(--dsw-static-neutral-bluish-50)` |
| `--dsw-alias-label-primary-dimmed` | `var(--dsw-static-neutral-bluish-950)` | `var(--dsw-static-neutral-bluish-100)` |
| `--dsw-alias-label-primary-foreground` | `var(--dsw-static-neutral-bluish-00)` | `var(--dsw-static-neutral-bluish-1000)` |
| `--dsw-alias-label-primary-inverted` | `var(--dsw-static-neutral-bluish-00)` | `var(--dsw-static-neutral-bluish-800)` |
| `--dsw-alias-label-secondary` | `var(--dsw-static-neutral-bluish-700)` | `var(--dsw-static-neutral-bluish-300)` |
| `--dsw-alias-label-tertiary` | `var(--dsw-static-neutral-bluish-600)` | `var(--dsw-static-neutral-bluish-400)` |
| `--dsw-alias-link` | `var(--dsw-static-deepseek-500)` | `var(--dsw-static-deepseek-400)` |
| `--dsw-alias-markdown-citation` | `var(--dsw-static-neutral-bluish-100)` | `var(--dsw-static-neutral-bluish-800)` |
| `--dsw-alias-markdown-code-block` | `var(--dsw-static-neutral-bluish-50)` | `var(--dsw-static-neutral-bluish-900)` |
| `--dsw-alias-markdown-code-block-banner` | `var(--dsw-static-neutral-bluish-50)` | `var(--dsw-static-neutral-bluish-850)` |
| `--dsw-alias-markdown-code-segment-selected` | `var(--dsw-static-neutral-bluish-00)` | `var(--dsw-static-neutral-bluish-800)` |
| `--dsw-alias-markdown-code-segment-unselected` | `var(--dsw-static-neutral-bluish-75)` | `var(--dsw-static-neutral-bluish-900)` |
| `--dsw-alias-markdown-inline-code` | `var(--dsw-static-neutral-50)` | `var(--dsw-static-neutral-800)` |
| `--dsw-alias-markdown-placeholder` | `var(--dsw-static-neutral-bluish-60)` | `var(--dsw-static-neutral-bluish-850)` |
| `--dsw-alias-markdown-tag` | `var(--dsw-static-neutral-bluish-75)` | `var(--dsw-static-neutral-bluish-850)` |
| `--dsw-alias-scrollbar-bg-l1` | `var(--dsw-static-neutral-200)` | `var(--dsw-static-neutral-700)` |
| `--dsw-alias-scrollbar-bg-l2` | `var(--dsw-static-neutral-200)` | `var(--dsw-static-neutral-600)` |
| `--dsw-alias-scrollbar-hover-l1` | `var(--dsw-static-neutral-300)` | `var(--dsw-static-neutral-600)` |
| `--dsw-alias-scrollbar-hover-l2` | `var(--dsw-static-neutral-300)` | `var(--dsw-static-neutral-550)` |
| `--dsw-alias-state-business-primary` | `var(--dsw-static-deepseek-500)` | `var(--dsw-static-deepseek-400)` |
| `--dsw-alias-state-business-tertiary` | `var(--dsw-static-deepseek-100)` | `var(--dsw-static-deepseek-800)` |
| `--dsw-alias-state-error-primary` | `var(--dsw-static-red-600)` | `var(--dsw-static-red-400)` |
| `--dsw-alias-state-error-secondary` | `var(--dsw-static-red-400)` | `var(--dsw-static-red-400)` |
| `--dsw-alias-state-success-primary` | `var(--dsw-static-green-500)` | `var(--dsw-static-green-500)` |
| `--dsw-alias-state-success-secondary` | `var(--dsw-static-green-400)` | `var(--dsw-static-green-400)` |
| `--dsw-alias-state-success-tertiary` | `var(--dsw-static-green-100)` | `var(--dsw-static-green-900)` |
| `--dsw-alias-state-warn-label` | `var(--dsw-static-amber-600)` | `var(--dsw-static-amber-600)` |
| `--dsw-alias-state-warn-primary` | `var(--dsw-static-amber-500)` | `var(--dsw-static-amber-500)` |
| `--dsw-alias-state-warn-secondary` | `var(--dsw-static-amber-400)` | `var(--dsw-static-amber-400)` |
| `--dsw-alias-state-warn-tertiary` | `var(--dsw-static-amber-100)` | `var(--dsw-static-amber-900)` |
| `--dsw-alias-toast-bg` | `var(--dsw-static-neutral-bluish-800)` | `var(--dsw-static-neutral-bluish-750)` |
| `--dsw-alias-tooltip-bg` | `var(--dsw-static-neutral-bluish-850)` | `var(--dsw-static-neutral-bluish-750)` |
| `--dsw-specific-bubble` | `var(--dsw-static-deepseek-50)` | `var(--dsw-static-neutral-bluish-850)` |
| `--dsw-specific-bubble-highlight` | `var(--dsw-static-deepseek-200)` | `var(--dsw-static-neutral-bluish-750)` |
| `--dsw-specific-input-major` | `var(--dsw-static-neutral-bluish-00)` | `var(--dsw-static-neutral-bluish-850)` |
| `--dsw-specific-login-input` | `var(--dsw-static-neutral-bluish-50)` | `var(--dsw-static-neutral-bluish-900)` |
| `--dsw-specific-menu` | `var(--dsw-alias-bg-layer-3)` | `var(--dsw-alias-bg-layer-3)` |
| `--dsw-specific-selector` | `var(--dsw-static-neutral-bluish-60)` | `var(--dsw-static-neutral-bluish-800)` |
| `--dsw-specific-sidebar-fill` | `var(--dsw-static-neutral-bluish-50)` | `var(--dsw-static-neutral-bluish-900)` |
| `--dsw-specific-sidebar-nav-item-active` | `var(--dsw-static-neutral-bluish-100)` | `var(--dsw-static-neutral-bluish-750)` |
| `--dsw-specific-sidebar-nav-item-active-accent` | `var(--dsw-static-deepseek-100)` | `var(--dsw-static-neutral-bluish-800)` |
| `--dsw-specific-sidebar-nav-item-hover` | `var(--dsw-static-neutral-bluish-75)` | `var(--dsw-static-neutral-bluish-850)` |
| `--dsw-specific-tip` | `var(--dsw-static-neutral-bluish-60)` | `var(--dsw-static-neutral-bluish-800)` |

**设计系统自己给出的 13 个「一等公民」token 及语义说明**（来自 `client.js:1131` 的 `BUILTIN_INSPECT_TOKENS`，也是 `ctx.theme.exportInspectTokens()` 的返回值）：

| 变量 | 设计系统描述 | 类型 | 必须同时给 light+dark |
|---|---|---|---|
| `--dsw-alias-bg-base` | Application base background. | CSS color | ✔ |
| `--dsw-alias-bg-layer-1` | Primary raised surface background. | CSS color | ✔ |
| `--dsw-alias-bg-layer-2` | Secondary nested surface background. | CSS color | ✔ |
| `--dsw-alias-bg-overlay` | Overlay and popover background. | CSS color | ✔ |
| `--dsw-alias-border-l1` | Primary subtle border. | CSS color | ✔ |
| `--dsw-alias-border-l2` | Secondary stronger border. | CSS color | ✔ |
| `--dsw-alias-brand-primary` | Primary brand accent. | CSS color | ✔ |
| `--dsw-alias-label-primary` | Primary text color. | CSS color | ✔ |
| `--dsw-alias-label-secondary` | Secondary text color. | CSS color | ✔ |
| `--dsw-alias-state-error-primary` | Primary error state color. | CSS color | ✔ |
| `--dsw-alias-state-success-primary` | Primary success state color. | CSS color | ✔ |
| `--dsw-alias-state-warn-primary` | Primary warning state color. | CSS color | ✔ |
| `--dsw-specific-sidebar-fill` | Sidebar column and title-row background. | CSS color | ✔ |

### 1.6 `--dsw-font-*` 字体阶梯（181 个唯一名）

两部分组成：**复合简写**（`--dsw-font-markdown-h1` 等，值形如 `700 21px/30px var(--dsw-font-family)`）+ **拆分子属性**（`-font-family` / `-font-size` / `-font-weight` / `-font-style` / `-line-height`）。全部声明在 theme `gradient-shadow-text.css` 的 `body{}`。

**与用户字号联动的 markdown 阶梯**（`--dsh-content-font-delta = 用户字号 - 14px`）：

| 复合变量 | 值 |
|---|---|
| `--dsw-font-markdown-h1` | `700 calc(21px + var(--dsh-content-font-delta)) / calc(30px + var(--dsh-content-font-delta)) var(--dsw-font-family)` |
| `--dsw-font-markdown-h2` | `700 calc(19px + var(--dsh-content-font-delta)) / calc(28px + var(--dsh-content-font-delta)) …` |
| `--dsw-font-markdown-h3` | `700 calc(18px + var(--dsh-content-font-delta)) / calc(26px + var(--dsh-content-font-delta)) …` |
| `--dsw-font-markdown-h4` | `600 var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) …` |
| `--dsw-font-markdown-base` | `var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) …` |
| `--dsw-font-markdown-base-strong` | `600 var(--dsh-content-font-size,14px) / calc(24px + …) …` |
| `--dsw-font-markdown-base-italic` | `italic var(--dsh-content-font-size,14px) / calc(24px + …) …` |
| `--dsw-font-markdown-base-strong-italic` | `italic 600 var(--dsh-content-font-size,14px) / calc(24px + …) …` |
| `--dsw-font-markdown-table` | `var(--dsh-content-font-size-secondary,13px)/calc(22px + var(--dsh-content-font-delta-secondary,0px)) …` |
| `--dsw-font-markdown-table-head` | `500 var(--dsh-content-font-size-secondary,13px)/calc(22px + …) …` |

对应子属性（以 h1 为例，每个阶梯都有 5 个）：
`--dsw-font-markdown-h1-font-family: var(--dsw-font-family)` / `-font-weight: 700` / `-font-size: calc(21px + var(--dsh-content-font-delta))` / `-line-height: calc(30px + var(--dsh-content-font-delta))` / `-font-style: normal`。

**固定尺寸的 markdown 小字/代码：**

| 复合变量 | 值 |
|---|---|
| `--dsw-font-markdown-small` | `12px/20px var(--dsw-font-family)` |
| `--dsw-font-markdown-small-strong` | `600 12px/20px var(--dsw-font-family)` |
| `--dsw-font-markdown-small-italic` | `italic 12px/20px …` |
| `--dsw-font-markdown-small-strong-italic` | `italic 600 12px/20px …` |
| `--dsw-font-markdown-code` | `12px/19px var(--ds-font-family-code)` |
| `--dsw-font-markdown-code-block` | `11px/19px var(--ds-font-family-code)` |
| `--dsw-font-markdown-code-block-small` | `11px/16px var(--ds-font-family-code)` |

**UI 通用阶梯（固定，不随用户字号变化）：**

| 复合变量 | 值（weight size/line-height family） |
|---|---|
| `--dsw-font-xl-24` | `600 24px/32px` |
| `--dsw-font-l-20` | `500 20px/28px` |
| `--dsw-font-m-18` | `500 16px/28px` ⚠️ 名字是 18，实际字号是 **16px** |
| `--dsw-font-base-16` | `400 16px/24px` |
| `--dsw-font-base-strong-16` | `500 16px/24px` |
| `--dsw-font-s-14` | `400 14px/22px` |
| `--dsw-font-s-strong-14` | `500 14px/22px` |
| `--dsw-font-xs-13` | `400 13px/20px` |
| `--dsw-font-xs-strong-13` | `500 13px/20px` |
| `--dsw-font-xxs-12` | `400 12px/18px` |
| `--dsw-font-xxs-strong-12` | `500 12px/18px` |
| `--dsw-font-xxxs-11` | `400 11px/14px` |
| `--dsw-font-xxxs-strong-11` | `500 11px/14px` |

### 1.7 阴影 / 高度 / 渐变 / 模糊 / 圆角（theme `gradient-shadow-text.css`）

```css
body{
  --dsw-linear-gradient-think:linear-gradient(180deg, #fff 20.19%, #fff0 100%);
  --dsw-linear-think-select:linear-gradient(180deg, #f5f6f7 20.19%, #f5f6f700 100%);
  --dsw-shadow-lv1:0 2px 4px 0 #0000000d;
  --dsw-shadow-lv1-blur:0 4px 12px 0 #00000005;
  --dsw-shadow-lv2:0 4px 12px 0 #00000005, 0 2px 8px 0 #0000000a;
  --dsw-shadow-lv3:0 0 1px 0 #0003, 0 0 4px 0 #00000005, 0 12px 32px 0 #00000014;
  --dsw-elevation-stroke-color:var(--dsw-alias-border-l4);
  --dsw-mask-blur:blur(2px);
}
body,body *{                                  /* 注意：通用选择器，逐元素重声明 */
  --dsw-elevation-stroke:0 0 0 .5px var(--dsw-elevation-stroke-color);
  --dsw-elevation-panel:var(--dsw-elevation-stroke), 0 3px 8px 0 #00000008, 0 0 16px 0 #00000005;
  --dsw-elevation-prominent:var(--dsw-elevation-stroke), 0 3px 8px 0 #0000000a, 0 0 20px 0 #0000000d;
  --dsw-elevation-soft:var(--dsw-elevation-stroke), 0 4px 16px 0 #00000008, 0 0 24px 0 #00000008;
}
body[data-ds-dark-theme]{
  --dsw-linear-gradient-think:linear-gradient(180deg, #151517 20.19%, #15151700 100%);
  --dsw-linear-think-select:linear-gradient(180deg, #232325 20.19%, #23232500 100%);
}
```

**圆角（theme `corner-shape.css` 全文）** —— 这是全树唯一的「圆角」相关全局变量：

```css
@supports (corner-shape:superellipse(1.5)){
  :root{--dsw-corner-shape:superellipse(1.5)}
  *,:before,:after{corner-shape:var(--dsw-corner-shape)}
}
```

> **重要结论：这套设计系统没有圆角刻度变量（没有 `--dsw-radius-*`）。** 所有 `border-radius` 都是组件内字面量（如 `12px` / `16px` / `22px` / `32px` / `999px`）。想统一圆角只能逐组件覆盖类名，或者在 `:root`/`body` 上覆盖 `--dsw-corner-shape` 来改「超椭圆」形态（只在支持 `corner-shape` 的引擎生效）。

### 1.8 滚动条（theme `scrollbar.css` 全文）

```css
body{--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l1);
     --dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l1);
     --dsh-scrollbar-width:8px}
@supports not selector(::-webkit-scrollbar){
  body,body *{scrollbar-width:thin;scrollbar-color:var(--dsh-scrollbar-thumb) transparent}
}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track{background:0 0}
::-webkit-scrollbar-thumb{background:var(--dsh-scrollbar-thumb);border-radius:4px}
::-webkit-scrollbar-thumb:hover{background:var(--dsh-scrollbar-thumb-hover)}
::-webkit-scrollbar-corner{background:0 0}
```

- `--dsh-scrollbar-width:8px` 是**只读镜像**：给需要与滚动条对齐的浮层用（ui-conversation 用它给 composer seat 做 `right:var(--dsh-scrollbar-width)`）。
- 两个渲染路径互斥：Firefox 走 `@supports not selector(::-webkit-scrollbar)` 的标准属性；WebKit 走伪元素。**`--dsh-scrollbar-thumb-hover` 只在 WebKit 伪元素路径下渲染。**
- l2 重绑约定：抬高面（菜单、popover、dialog、审批卡、composer、侧栏 root）在自己容器上重绑到 `-l2` 系列；`transparent` 是另一个合法目标（ui-sidebar 在指针离开时、ui-trajectory 也用）。

### 1.9 shiki 语法高亮（theme `shiki.css` 全文）

```css
:root{
  --shiki-foreground:var(--dsw-alias-label-primary);
  --shiki-background:var(--dsw-alias-markdown-code-block);
  --shiki-token-constant:#1c7ed6; --shiki-token-string:#2f9e44; --shiki-token-comment:#868e96;
  --shiki-token-keyword:#d6336c; --shiki-token-parameter:#e8590c; --shiki-token-function:#6741d9;
  --shiki-token-string-expression:#2b8a3e; --shiki-token-punctuation:#495057; --shiki-token-link:#1971c2;
}
body[data-ds-dark-theme]{
  --shiki-token-constant:#4dabf7; --shiki-token-string:#69db7c; --shiki-token-comment:#adb5bd;
  --shiki-token-keyword:#faa2c1; --shiki-token-parameter:#ffa94d; --shiki-token-function:#b197fc;
  --shiki-token-string-expression:#8ce99a; --shiki-token-punctuation:#ced4da; --shiki-token-link:#74c0fc;
}
```

### 1.10 `--dsh-*` 应用层变量（完整表）

⚠️ `--dsh-*` **不是颜色层**，是尺寸/几何/耦合层。下表是「声明处 + 值 + 声明者」，全部为产物字面量。

| 变量 | 默认值 | 声明者（包/选择器） |
|---|---|---|
| `--dsh-content-font-size` | `14px`（由 presenter 写死内联）；合法 12–17 整数 | `ui-layout` ThemePresenter 写在 `body.style`；boot 脚本也写 |
| `--dsh-content-font-delta` | `calc(var(--dsh-content-font-size,14px) - 14px)` | theme `gradient-shadow-text.css` `body{}` |
| `--dsh-content-font-size-secondary` | `min(calc(var(--dsh-content-font-size,14px) - 1px), max(13px, calc(var(--dsh-content-font-size,14px) - 2px)))` | 同上 |
| `--dsh-content-font-delta-secondary` | `calc(var(--dsh-content-font-size-secondary) - 13px)` | 同上 |
| `--dsh-scrollbar-thumb` | `var(--dsw-alias-scrollbar-bg-l1)` | theme `scrollbar.css` `body` |
| `--dsh-scrollbar-thumb-hover` | `var(--dsw-alias-scrollbar-hover-l1)` | 同上 |
| `--dsh-scrollbar-width` | `8px` | 同上 |
| `--dsh-sidebar-inline-padding` | `12px` | `ui-sidebar` `SidebarRoot.module.css` `.hHd-Xa_root` |
| `--dsh-session-list-edge-inset` | `var(--dsh-sidebar-inline-padding)` | `ui-workspace` `WorkspaceBrowser.module.css` `.bhn1Oq_root` |
| `--dsh-session-list-scrollbar-width` | `8px` | 同上 |
| `--dsh-session-list-scrollbar-offset` | `2px` | 同上 |
| `--dsh-chat-content-width` | `var(--dsh-chat-user-width, clamp(680px, calc(var(--dsh-conversation-column-width,0px) * .64), 920px))` | `ui-conversation` `ConversationRoot.module.css` `.wSkVaW_root` |
| `--dsh-composer-card-max-width` | `calc(var(--dsh-chat-content-width) + 32px)` | 同上 |
| `--dsh-composer-side-clearance` | `16px` | 同上 |
| `--dsh-composer-dock-inset` | `8px` | 同上 |
| `--dsh-composer-stack-gap` | `6px` | 同上（`.wSkVaW_composerStack`） |
| `--dsh-composer-text-max-height` | `336px` | 同上（`.wSkVaW_composerSeat`） |
| `--dsh-composer-height` | 运行时由 `ResizeObserver` 写入 `${seat.offsetHeight}px`；消费方 fallback `152px` | `ui-conversation` JS：`scroller.style.setProperty("--dsh-composer-height", …)` |
| `--dsh-conversation-viewport-height` | 运行时写 `${scroller.clientHeight}px` | 同上 |
| `--dsh-conversation-column-width` | 未找到声明（只被读取，fallback `0px`） | — |
| `--dsh-chat-user-width` | 未找到声明（只被读取，无 fallback） | — |
| `--dsh-chat-flow-gap` | `8px`（仅在 `.EvIC1a_flowItem[data-turn-process-answer]` 上）；通用处 fallback `16px` | `ui-chat` `ChatView.module.css` |
| `--dsh-composer-hint` | 由 JS 内联写入 `JSON.stringify(hint)` | `ui-conversation` JS：`style:{"--dsh-composer-hint": …}` |
| `--dsh-width-handle-pointer-y` | 未找到声明（只被读取，fallback `50%`） | — |
| `--dsh-answer-field-padding` | `0` / `8px 12px`（两个值，不同规则） | `ui-client-ui-user-questions` |
| `--dsh-trajectory-toolbar-height` | `32px` | `ui-trajectory` |
| `--dsh-trajectory-bottom-clearance` | `calc(var(--dsh-composer-height,152px) + 16px)` | `ui-trajectory` |
| `--dsh-state-ongoing` | `var(--dsw-static-deepseek-450)` | dist CSS `._dot_1tljr_3,._matrix_1tljr_4` |
| `--dsh-file-type-default-color` | 每个后缀一个值（见下） | dist CSS `._code_1wejo_8` 等 |
| `--dsh-file-type-icon-color` | 未声明（只被 `._icon_1wejo_1` 读取，fallback `var(--dsh-file-type-default-color)`） | — |
| `--dsh-file-type-violet` | `rgb(139, 118, 246)` | dist CSS `._icon_1wejo_1` |
| `--dsh-font-mono` | 未声明（被 `ui-cordis` 读取，fallback `monospace`） | — |
| `--dsh-toast-hold` | 由 JS 内联写 `${holdMs}ms`；CSS fallback `3s` | shell bundle，toast portal |
| `--dsh-boot-arc` | 由 JS 内联写 `${72 + t*216}deg`；CSS fallback `72deg` | shell bundle，boot spinner |
| `--dsh-boot-bg` | `#fff` / `#151517` | dist CSS `._boot_1fywu_3` / dark |
| `--dsh-boot-label-primary` | `#0f1115` / `#f9fafb` | 同上 |
| `--dsh-boot-label-secondary` | `#61666b` / `#cfd3d6` | 同上 |
| `--dsh-boot-label-tertiary` | `#81858c` / `#adb2b8` | 同上 |
| `--dsh-boot-border` | `rgb(0 0 0 / 10%)` / `rgb(255 255 255 / 12%)` | 同上 |
| `--dsh-boot-brand` | `#0f1115` / `#f9fafb` | 同上 |

**`--dsh-file-type-default-color` 的全部取值**（按文件类型图标类）：

| 选择器 | 值 |
|---|---|
| `._code_1wejo_8` | `var(--dsw-static-deepseek-500)` |
| `._excel_1wejo_12` | `var(--dsw-static-green-500)` |
| `._html_1wejo_20` | `var(--dsw-static-amber-500)` |
| `._image_1wejo_24` | `var(--dsh-file-type-violet)` |
| `._markdown_1wejo_28` | `var(--dsw-static-deepseek-450)` |
| `._other_1wejo_32` | `var(--dsw-static-neutral-bluish-300)` |
| `._pdf_1wejo_36` | `var(--dsw-static-red-600)` |
| `._ppt_1wejo_40` | `var(--dsw-static-amber-400)` |
| `._word_1wejo_48` | `var(--dsw-static-deepseek-500)` |
| `._folder_1wejo_16` / `._video_1wejo_44` | 未在 CSS 中找到单独赋值 |

### 1.11 `--dsl-*` 工具视图变量（17 个）

| 变量 | 值 | 声明选择器 |
|---|---|---|
| `--dsl-code-block-background` | `var(--dsw-alias-markdown-code-block)` | `._block_rsn9u_4` |
| `--dsl-code-block-banner-background-color` | `var(--dsw-alias-markdown-code-block-banner)` | 同上 |
| `--dsl-code-block-banner-font` | `11px/18px var(--dsw-font-family)` | 同上 |
| `--dsl-code-block-border-radius` | `12px` | 同上 |
| `--dsl-code-block-content-font` | `var(--dsw-font-markdown-code-block)` | 同上（tool 内覆写为 `--dsw-font-markdown-code-block-small`） |
| `--dsl-diff-line-height` | `22px` | `._block_12o37_1` |
| `--dsl-diff-radius` | `12px` | 同上 |
| `--dsl-read-gutter` | `48px` | `._block_onbk6_1` |
| `--dsl-read-line-height` | `22px` | 同上 |
| `--dsl-read-radius` | `12px` | 同上 |
| `--dsl-search-line-height` | `22px` | `._block_1h7p4_1` |
| `--dsl-search-radius` | `12px` | 同上 |
| `--dsl-terminal-font` | `var(--dsw-font-markdown-code-block)` | `._block_1gdtu_1` |
| `--dsl-terminal-gutter` | `30px` | 同上 |
| `--dsl-terminal-line-height` | `22px` | 同上 |
| `--dsl-terminal-radius` | `12px` | 同上 |
| `--dsl-web-radius` | `12px` | `._block_19q7d_1` |

**未出现在 dist CSS、但工具包自己声明的补充变量**（`ui-tool` / `dsh-client-ui-tool`）：

- `--dsl-terminal-output-max-height:224px`（`.o3BgMG_terminalBody`、`.CY-8Ka_terminal`）
- `--dsl-terminal-font:var(--dsw-font-markdown-code-block-small)` 与 `--dsl-terminal-line-height:18px`（同上，工具内二次覆写）

### 1.12 `--json-tree-*`（JSON 树查看器，7 个）

```css
._root_4qrvp_1{
  --json-tree-property:#881391; --json-tree-string:#c41a16; --json-tree-number:#1c00cf;
  --json-tree-keyword:#1c00cf; --json-tree-punctuation:#202124; --json-tree-icon:#5f6368;
  --json-tree-hover:rgb(60 64 67 / 4%);
}
body[data-ds-dark-theme] ._root_4qrvp_1{
  --json-tree-property:#5db0d7; --json-tree-string:#f28b82; --json-tree-number:#99c8ff;
  --json-tree-keyword:#99c8ff; --json-tree-punctuation:#e8eaed; --json-tree-icon:#9aa0a6;
  --json-tree-hover:rgb(232 234 237 / 5%);
}
```

### 1.13 其它零散变量

- `--turn-rail-band:calc(var(--dsh-conversation-viewport-height,100dvh) - var(--dsh-composer-height,152px))`、`--turn-preview-height:100px`（`ui-chat` `TurnNavigator.module.css` `.eGxaPq_frame`）
- 局部 `--dsw-elevation-stroke-color` 重绑（把「0.5px 发丝描边」改成别的 token）出现于：`.EvIC1a_toBottom`（`border-l3`）、`.uV2eYG_card`（`border-l2`）、若干按钮/浮层。

### 1.14 被引用频次最高的 token（决定你改哪个变量收益最大）

| 次数 | 变量 |
|---|---|
| 227 | `--dsw-alias-label-tertiary` |
| 223 | `--dsw-alias-label-primary` |
| 172 | `--dsw-alias-label-secondary` |
| 102 | `--dsw-alias-interactive-bg-hover` |
| 80 | `--dsw-alias-state-business-primary` |
| 79 | `--dsw-alias-state-error-primary` |
| 78 | `--dsw-alias-label-caption` |
| 66 | `--dsw-font-family` |
| 55 | `--dsw-alias-border-l2` |
| 42 | `--dsw-alias-border-l4` |
| 41 | `--dsw-alias-bg-layer-1` |
| 36 | `--dsw-alias-border-l1` |
| 33 | `--dsw-alias-border-l3` |
| 29 | `--dsw-font-xs-13` |
| 27 | `--dsw-alias-bg-base` |
| 25 | `--dsw-alias-scrollbar-bg-l2` / `--dsw-alias-scrollbar-hover-l2` |

### 1.15 明暗主题切换机制（确切机制与选择器）

**不是 class，没有 `data-theme`。** 三个 DOM 字段：

| 字段 | 位置 | 写入者 | 取值 |
|---|---|---|---|
| `color-scheme` | `document.documentElement.style`（即 `<html style="color-scheme: dark">`） | ① boot 内联脚本 ② ThemePresenter | `"light"` / `"dark"` |
| `data-ds-dark-theme` | `<body>` 属性（**存在即暗色，值恒为空串**） | 同上 | 存在/不存在 |
| `--dsh-content-font-size` | `document.body.style` 内联 | 同上 | `${12..17}px` |

**CSS 侧的选择器就是：**

```css
body { /* light 色板 */ }
body[data-ds-dark-theme] { /* dark 色板覆盖 */ }
```

**运行时 presenter（`dsh-client-ui-layout/lib/client.js:441-492`）逐行：**

```js
const DARK_ATTRIBUTE = "data-ds-dark-theme";
const CONTENT_FONT_SIZE_VARIABLE = "--dsh-content-font-size";
apply(snapshot) {
  const scheme = snapshot.active.colorScheme;            // 只依据 colorScheme，绝不依据 theme id
  document.documentElement.style.colorScheme = scheme;
  const body = document.body;
  if (scheme === "dark") body.setAttribute(DARK_ATTRIBUTE, "");
  else body.removeAttribute(DARK_ATTRIBUTE);
  body.style.setProperty(CONTENT_FONT_SIZE_VARIABLE, `${snapshot.fontSize}px`);
  for (const name of this.appliedTokens) body.style.removeProperty(name);
  this.appliedTokens = [];
  for (const [name, value] of Object.entries(snapshot.active.tokens)) {
    body.style.setProperty(name, value);                 // 第三方主题的 token 覆写 = body 内联样式
    this.appliedTokens.push(name);
  }
  this.themeColorMeta.content = getComputedStyle(body).backgroundColor;
  if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta);
}
```

**首屏（React 之前）的 boot 脚本**（`dsh-client-ui-theme/lib/index.js:38-48`，Host 侧把当前持久化偏好内联进 index.html）：

```js
function bootThemeScript(preference, fontSize) {
  return `(() => {
  const preference = ${JSON.stringify(preference)}
  const systemDark = preference === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preference === 'dark' || systemDark
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.toggleAttribute('data-ds-dark-theme', dark)
  document.body.style.setProperty('--dsh-content-font-size', ${JSON.stringify(`${fontSize}px`)})
})()`;
}
return { kind: "script", placement: "body", text: bootThemeScript(preference, fontSize) };
```

> 注意 boot 脚本用 `toggleAttribute('data-ds-dark-theme', dark)` —— 暗色时属性**存在且值为空**；presenter 用 `setAttribute(DARK_ATTRIBUTE, "")`，两者一致。CSS 选择器必须是**属性存在判断**，不能写 `[data-ds-dark-theme="true"]`。

`prefers-color-scheme` 由客户端服务持有：`matchMedia("(prefers-color-scheme: dark)")`，偏好为 `system` 且 OS 切换时重新 `publish()`（`client.js:1256`、`:1258-1270`）。

**唯一的两个 html/body 主题写入者**（全树 grep 结果）：
- `dsh-client-ui-layout/lib/client.js` → `documentElement.style.colorScheme` / `body.setAttribute(DARK_ATTRIBUTE,"")`
- `dsh-client-ui-theme/lib/index.js` → `documentElement.style.colorScheme` / `document.body.toggleAttribute('data-ds-dark-theme', dark)`

此外 presenter 还会写一个**恰好一个** `<meta name="theme-color">` 到 `document.head`（内容为计算后的 `body` 背景色），dispose 时移除。

### 1.16 主题偏好存储在哪里

| 项 | 值 | 证据 |
|---|---|---|
| settings namespace | `"ui-theme"` | `THEME_SETTINGS_NAMESPACE = "ui-theme"`（`ui-theme/lib/index.js:11`） |
| 字段 1 | `preference`，取值 `"light" \| "dark" \| "system"`，默认 `"system"` | `THEME_PREFERENCES = ["light","dark","system"]`、`DEFAULT_PREFERENCE = "system"`（`:5-17`） |
| 字段 2 | `fontSize`，整数 12–17，默认 `14` | `z.number().step(1).min(12).max(17).default(14)`（`:25-28`） |
| 落盘位置 | `<DSH_HOME>/settings.yaml`（可被 `path` 配置覆盖；`.yaml`/`.yml`/`.json` 由扩展名决定） | `dsh-settings-file/lib/index.js:27,32`：`otherwise the document lives at \`<harness home>/settings.yaml\`` / `const filename = resolve(config.path ?? join(resolveDshHome(config.dshHome), "settings.yaml"));` |
| 注册方式 | Host 侧 `settingsCtx.settings.register("ui-theme", ThemeSettingsSchema)` | `ui-theme/lib/index.js:88` |
| 客户端作用域 | `ctx.settingsScope.bind({ namespace: THEME_SETTINGS_NAMESPACE })` | `ui-theme/lib/client.js:1471` |
| 跨进程边界 | 仅 loopback 浏览器创建 Host 支持的 scope；非 loopback 页面两个选择仅进程内 | `ui-theme/README.md:66` |
| 第三方 theme id | **不进入 settings schema**，纯进程内扩展 | `README.md:36` |

### 1.17 客户端主题 API（可被第三方复用的完整签名）

服务由 `dsh-client-ui-theme` 提供：`ctx.provide("theme", theme)`（`client.js:1472`），类型为 `ThemeRuntime`。

```ts
// 读取
getTheme(): ThemeSnapshot                       // 冻结快照，直到下次变化前引用稳定
exportInspectTokens(): ThemeTokenInspection[]   // JSON-safe 的 token 目录，含已注册与仅覆写的名字

// 写入（唯一入口）
setTheme(id: string): void        // id = 已注册 theme id 或 "system"；未知 id 抛错；相同值直接 return
setFontSize(px: number): void     // 必须整数且在 12..17，否则 throw `font size ${px} is outside 12..17`

// 注册第三方主题
register(definition: ThemeDefinition): () => void
// definition: { id: string; colorScheme: "light" | "dark"; tokens: Record<string,string> }
// id === "system" → throw `"system" is a preference, not a registrable theme id`
// 重复 id → throw `theme "${id}" is already registered`
// disposer：若被销毁的正是当前偏好主题，偏好回落 DEFAULT_PREFERENCE("system")

// token 级覆写层（可叠加、后注册者按 token 取胜）
overrideTokens(source: string, tokens: ThemeTokenOverrides): () => void
// tokens: Record<string, { light: string; dark: string }>
// 传字符串 → TypeError：`theme override "${name}" from "${source}" is a bare string — pass { light: …, dark: … } …`
// 传错形状 → TypeError：`theme override "${name}" from "${source}" must map to a { light, dark } pair of strings …`
```

```ts
interface ThemeSnapshot {
  preference: "light" | "dark" | "system";   // 持久化偏好，可能是 system
  fontSize: number;                          // 会话内容字号 px
  active: ThemeDefinition;                   // 已解析（system 已展开）且已折叠覆写层
  themes: readonly ThemeDefinition[];        // 注册顺序
  revision: number;                          // 单调递增
}
interface ThemeTokenInspection {
  name: string; description: string; valueType: string;
  requiresLightAndDark: boolean; cssVariable?: string;
}
```

**事件**（`declare module '@deepseek-ai/cordis'`）：

```ts
'theme/change'(snapshot: ThemeSnapshot): void   // @mode emit
```

`inject`：`["slots", "locale", "remote", "settingsScope"]`（`client.js:1457`）。

`SETTINGS_NS = "settings.theme"`（仅用于设置行文案的 locale 命名空间，`client.js:1121`）。

**注入顺序注意：** `ui-theme` 先 `installThemeStyles(ctx)` 挂 6 张全局样式表，再 `new ThemeRuntime(...)`。`ui-layout` 的 presenter 在 `ctx.on("theme/change")` 上工作，且启动时立即 `presenter.apply(ctx.theme.getTheme())`。

---

## 2. 稳定 CSS 类名清单

### 2.1 三种命名体系（先搞清这个，否则类名对不上）

| 产物 | 命名规则 | 例子 |
|---|---|---|
| **dist CSS**（Vite 构建，含 shell + primitives + dockkit） | `_<原名>_<5位模块hash>_<源文件行号>` | `_button_cfgyt_4`、`_root_1nxmc_1`、`_toast_e5v0f_6` |
| **client 插件的 CSS module**（rolldown + `\0dsh-css:` 插件） | `<6位模块id>_<原名>` | `pI_x6G_frame`、`hHd-Xa_root`、`wSkVaW_root`、`uV2eYG_card` |
| **全局类**（非 CSS module） | 原名 | `.line`、`.md-code-block`、`.md-table-wide`、`.katex-*` |

**关键性质：两种 hash 方案都把「原始 CSS module 类名」原样嵌进产出类名里。** 所以 `_toast_e5v0f_6` 就是 `Toast.module.css` 里的 `.toast`，`wSkVaW_root` 就是 `ConversationRoot.module.css` 里的 `.root`。这让归属判断变得可行。

**稳定性诚实声明：**
- 同一构建内这些名字**完全确定**（哈希由模块路径/内容派生）。
- **跨构建是否保持，无法从单一产物验证。** 因此把 hash 类名写进长期维护的自定义 CSS 有风险。
- **优先使用 §4 的 `[data-slot="…"]` 与 `data-*` 属性选择器** —— 它们是源码里的字符串字面量，不经过哈希，是最稳的钩子。hash 类名作为「必要时才用」的兜底。

### 2.2 dist CSS 的 28 个模块分组全集（`index-DPX2bQLO.css`，255 个类）

下面按模块 hash 分组，**这是 dist CSS 里全部 255 个类的完整清单**。组名标注为「已证实」或「推断」。

| hash | 组件（证据强度） | 类名 |
|---|---|---|
| `1fywu` | **首屏加载页 boot**（已证实：JS 直接构造 DOM） | `boot`(3) `card`(26) `wordmark`(33) `hint`(41) `spinner`(47) `failed`(74) `failedTitle`(81) `failedItem`(88) |
| `17p4l` | **DockKit**（停靠面板/标签/分屏/浮动层；已证实） | `split`(17) `splitRow`(24) `splitColumn`(28) `splitCell`(32) `divider`(39) `surface`(125) `pane`(133) `tabStrip`(156) `tab`(156) `stripTabs`(173) `stripFill`(204) `stripChrome`(212) `slot`(224) `tabActive`(243) `slotCaret`(243) `tabTitle`(286) `float`(306) `floatTitle`(306) `tabClose`(314) `addTab`(346) `tabQuiet`(385) `tabDragging`(402) `iconButton`(408) `menu`(444) `menuItem`(460) `paneBody`(478) `empty`(490) `dockScrim`(498) `dockHint`(500) `dockHintCard`(505) `dockHintLabel`(593) `floatHeader`(664) `dockGlyph`(681) `floatBody`(686) `floatResize`(696) |
| `1tljr` | **状态点 StateDot**（已证实：`span.Gl.dot[data-state]` / `svg.Gl.matrix`） | `dot`(3) `matrix`(4) `cell`(62) |
| `luwio` | **DisclosureRow 折叠行**（已证实：`U1.*` 被 ToolRow 以 `rowClassName/leadingClassName/titleClassName/chevronClassName` 传入） | `root`(9) `row`(16) `leading`(29) `iconIdle`(57) `chevronHover`(63) `title`(79) |
| `cfgyt` | **Button 基元**（已证实：`{button,md,sm,primary,ghost,outline,toolbar,icon}`，`w2` 组件 `className:Ce(io.button,io[variant],io[size])`） | `button`(4) `md`(24) `sm`(30) `primary`(38) `ghost`(47) `outline`(56) `toolbar`(65) `icon`(73) |
| `e3ygd` | **Pill 胶囊标签**（已证实：`Ce(Sr.pill, Sr.interactive, active&&Sr.active)`，`<button>` 或 `<span>`） | `pill`(1) `interactive`(15) `active`(23) |
| `brmue` | **Tag**（已证实：`<span className={Ce(d7.tag,r)} data-tone={tone}>`，tone 默认 `outline`） | `tag`(4) |
| `1vyxu` | **Switch**（已证实：`<button role="switch" aria-checked>` + `<span class=thumb>`） | `switch`(10) `thumb`(38) |
| `1g6ru` | **Input 带图标输入框**（已证实：`<span class=wrap><span class=icon>…</span><input class=input></span>`） | `wrap`(1) `icon`(16) `input`(25) |
| `1nxmc` | **Menu / 上下文菜单**（已证实：`[role=menuitem]`、`role=separator`、`Pe.submenu[role=menu]`） | `root`(1) `list`(8) `submenu`(9) `portal`(44) `sideTop`(52) `alignEnd`(57) `scrollable`(22) `viewport`(22) `footer`(64) `separator`(82) `itemWrap`(92) `item`(92) `denseList`(119) `label`(124) `compactList`(128) `itemIcon`(144) `itemLabel`(174) `check`(182) `selected`(189) `selectedFill`(194) `danger`(199) |
| `1b2ny` | **可复制代码/文本卡**（推断：`root/card/copyable/feedback/copied/status`） | `root`(3) `card`(13) `copyable`(25) `feedback`(34) `copied`(40) `status`(47) |
| `w1urq` | **Modal/Dialog**（已证实：`Ut.root[role=presentation] > Ut.mask[aria-hidden] + Ut.dialog[role=dialog][aria-modal]`，portal 到 body） | `root`(2) `mask`(14) `dialog`(22) `content`(37) `header`(45) `title`(53) `close`(61) `description`(80) `body`(89) `footer`(97) |
| `1cfrq` | **Onboarding 遮罩** | `onboardingOverlay`(3) `onboardingMask`(10) `onboardingStage`(21) |
| `1nu42` | **需确认的危险操作对话框** | `confirmation`(1) `confirmationContent`(7) `warning`(19) `warningIcon`(32) `acknowledgement`(38) `modalAction`(67) `confirmAction`(71) |
| `1ycze` | **三态指示器（带 3 点动画）**（推断） | `indicator`(1) `warning`(20) `success`(39) `icon`(44) `label`(51) `stateLabel`(56) `hoverLabel`(57) `sizeLabel`(58) `dots`(78) `secondDot`(84) `thirdDot`(88) |
| `1wejo` | **文件类型图标**（已证实：`wc.icon/code/excel/folder/html/image/markdown/other/pdf/ppt/video/word`；含 `--dsh-file-type-*`） | `icon`(1) `code`(8) `excel`(12) `folder`(16) `html`(20) `image`(24) `markdown`(28) `other`(32) `pdf`(36) `ppt`(40) `video`(44) `word`(48) |
| `z12h9` | **内联 chip（引用/slash 命令）**（已证实：`span.Er.refChip[data-ref-chip]`、`Er.slashChip`、`Er.refIcon`、`Er.plainRun`） | `plainRun`(6) `refChip`(11) `slashChip`(27) `refIcon`(36) |
| `1nw3t` | **Tooltip 气泡**（已证实：`span.Vf.bubble[role=tooltip][data-side]`） | `bubble`(1) |
| `e5v0f` | **Toast**（已证实：`createPortal(div.Yl.toast[role=alert] > span.Yl.icon + span.Yl.text, document.body)`） | `toast`(6) `icon`(37) `text`(44) |
| `4qrvp` | **JSON 树查看器**（已证实：`data-json-root-row` / `data-json-copy-active`，`--json-tree-*`） | `root`(1) `container`(30) `expandedTopLevel`(39) `topLevelBracket`(46) `expandedTopLevelContainer`(51) `row`(55) `children`(60) `expander`(78) `label`(95) `clickableLabel`(101) `stringValue`(105) `numberValue`(109) `keywordValue`(113) `otherValue`(117) `punctuation`(121) `preview`(125) `previewProperty`(129) `previewEllipsis`(133) `copyAnchor`(137) `copyButton`(143) `collapseIcon`(202) `collapsedContent`(214) |
| `1gdtu` | **Terminal 工具视图**（已证实：`data-terminal=""`、`--dsl-terminal-*`、`data-running`） | `block`(1) `header`(32) `prompt`(70) `promptLine`(78) `runState`(91) `runStateLabel`(99) `cwd`(108) `command`(116) `status`(128) `copyButton`(136) `output`(156) `line`(180) `expand`(185) `empty`(201) |
| `onbk6` | **Read / 文件读取工具视图**（已证实：`data-read=""`、`--dsl-read-*`） | `block`(1) `banner`(15) `label`(26) `action`(37) `count`(44) `lang`(49) `copyButton`(56) `body`(66) `line`(75) `gutter`(82) `content`(93) `expand`(97) |
| `12o37` | **Diff 工具视图**（已证实：`data-diff=""`、`--dsl-diff-*`） | `block`(1) `copyButton`(16) `body`(30) `line`(38) `path`(47) `gap`(54) `del`(61) `add`(70) `expand`(79) `footer`(97) |
| `1h7p4` | **Search 工具视图**（已证实：`data-search=<kind>`、`--dsl-search-*`） | `block`(1) `header`(12) `summary`(22) `copyButton`(32) `body`(43) `line`(52) `lineNumber`(60) `fileHeader`(66) `filePath`(80) `fileCount`(87) `expand`(92) `empty`(108) |
| `rsn9u` | **Markdown 代码块（shiki）**（已证实：`--dsl-code-block-*`、`pre.shiki`、`code>.line`） | `block`(4) `bannerWrap`(24) `banner`(24) `infostring`(45) `action`(56) `copyButton`(62) `content`(74) `shiki`(93) `plain`(103) `numbered`(107) |
| `kcgor` | **Markdown 渲染容器**（已证实：`div.a1.markdown` 包裹 ReactMarkdown 输出；全局类 `md-table-wide`） | `markdown`(5) `linkIcon`(92) `tableScroll`(190) `tableFill`(236) `image`(284) `imageAlt`(284) `fileMention`(304) |
| `19q7d` | **Web 搜索/抓取工具视图**（已证实：`data-web="search"` / `"fetch"`、`--dsl-web-radius`） | `block`(1) `answer`(13) `sources`(40) `source`(40) `sourceLink`(54) `linkIcon`(65) `snippet`(78) `published`(86) `truncated`(92) `empty`(98) `fetch`(104) `fetchUrl`(110) `fetchMeta`(126) `status`(132) |
| `1fdcq` | **可折叠 JSON/preview 揭示块**（已证实：`<div class=Jl.root><button class=Jl.toggle>▾/▸</button><pre class=Jl.body>`） | `root`(1) `toggle`(5) `body`(20) |

**全局（非 hash）类名（dist CSS 中）**：`.line`、`.md-code-block`、`.md-table-wide`、`.katex`、`.katex-display`（后两者来自 vendor CSS）。`vendor-BNsW4eBh.css`（29KB）**完全是 KaTeX**，没有任何布局类名 —— 已逐类核对，141 个类名全部属于 KaTeX。

### 2.3 各包 CSS-module 类名表（client 插件）

#### `dsh-client-ui-layout` —— `.pI_x6G_*`

| 原名 | 产物类名 | 用途 |
|---|---|---|
| `frame` | `pI_x6G_frame` | **三列网格骨架根**（`display:grid`，`grid-template-columns` 由 JS 内联写） |
| `sidebarCol` | `pI_x6G_sidebarCol` | 左列网格项（`background:var(--dsw-specific-sidebar-fill)`，`border-right:.5px solid var(--dsw-alias-border-l3)`） |
| `centerCol` | `pI_x6G_centerCol` | 中列网格项（`display:flex;flex-direction:column`） |
| `rightbarCol` | `pI_x6G_rightbarCol` | 右列网格项（`position:relative;overflow:visible`） |
| `overlayLayer` | `pI_x6G_overlayLayer` | 帧级浮层（`z-index:20;pointer-events:none;position:absolute;inset:0`；子元素恢复 `pointer-events:auto`） |
| `handle` | `pI_x6G_handle` | 列宽拖拽把手（`z-index:11;width:8px;margin-left:-4px;cursor:col-resize`） |

CSS 全文（`dsh-client-ui-layout/lib/client.js:71`，单行原文）：
`".pI_x6G_frame{background:var(--dsw-alias-bg-base);height:100%;transition:grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out);grid-template-rows:100%;display:grid;position:relative;overflow:hidden}.pI_x6G_frame[data-dragging]{transition:none}…"`

#### `dsh-client-ui-sidebar` —— `.hHd-Xa_*`（35 个）

完整 map（`client.js` 内的 `SidebarRoot_module_css_default`）：
`root` `collapsed` `wide` `fading` `quietBars` `railIn` `logoRow` `brand` `brandIdentity` `brandMark` `brandName` `fallbackBrandName` `localBuildBrand` `localBuildTitle` `buildVersion` `toggle` `iconButton` `railMark` `panelIcon` `newSession` `newSessionLabel` `panelList` `panelRow` `panelActive` `panelGlyph` `panelTitle` `regionArea` `footArea` `footerActions` `settingsArea`，以及动画名 `rail-in` `rail-fade-in` `wide-in`。
全部形如 `hHd-Xa_<原名>`。

关键几何：`.hHd-Xa_root{--dsh-sidebar-inline-padding:12px;height:100%;padding:6px var(--dsh-sidebar-inline-padding);background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex-direction:column;font-size:14px;display:flex}`

#### `dsh-client-ui-workspace`（会话/工作区列表，渲染在侧栏 `sidebar.workspaces` 座）

| 模块 | 类名前缀 | 数量 | 关键类 |
|---|---|---|---|
| `rows/Rows.module.css` | `YDXeBa_*` | 38 | `projectRow` `sessionRow` `selected` `title` `time` `meta` `rowActions` `iconButton` `slot` `chevron` `arrow` `arrowOpen` `folder` `folderActive` `menuOpen` `renameInput` `dropBefore` `dropAfter` `scheduleIndicator` `hoverContent` `hoverTitle` `hoverTime` `hoverStatus` `searchResultRow` `searchResultHeading` `searchResultTitle` `searchResultMeta` `searchResultWorkspace` `searchResultSnippet` `flatSessionRowWithoutStatus` `visuallyHidden` |
| `rows/WorkspaceBrowser.module.css` | `bhn1Oq_*` | 37 | `root` `rail` `listArea` `list` `treeBody` `flatList` `groupSection` `sectionHeader` `sectionLabel` `sectionLabelHidden` `headerActions` `headerActionsHidden` `search` `searchSlot` `searchSlotExpanded` `searchButton` `searchInput` `searchExpanded` `searchTree` `searchStatus` `searchWarning` `clearButton` `iconButton` `empty` `fade` `renameInput` `renameError` `deleteAction` `deleteStatus` `sessionOverflowButton` `listTopDropIndicator` `listTopDropActive` `workspaceDropBefore` `workspaceDropAfter` `wide` `wide-in` |
| `WorkspacePicker.module.css` | `_G5b-a_*` | 3 | `modalAction` `modalError` `menuStatus` |

#### `dsh-client-ui-sidebar-right`（右栏）—— 3 个模块

| 模块 | 类名 |
|---|---|
| `shell/SidebarRight.module.css` | `P3OORG_panel` `P3OORG_panelBody` `P3OORG_iconButton` `P3OORG_collapseGlyph` `P3OORG_unavailable` `P3OORG_floatHost` |
| `shell/ExpandButton.module.css` | `_1kL45W_button` `_1kL45W_icon` |
| `tabs/guide/GuideBody.module.css` | `geFEbW_guide` `geFEbW_hero` `geFEbW_entry` `geFEbW_entryIcon` `geFEbW_entryText` `geFEbW_entryTitle` `geFEbW_entryDescription` `geFEbW_placeholderInk` `geFEbW_titleIcon` |

关键几何：`.P3OORG_panel{z-index:10;background:var(--dsw-alias-bg-base);border-left:.5px solid var(--dsw-alias-border-l4);visibility:hidden;position:absolute;top:0;bottom:0;right:0;transform:translate(100%)}` / `[data-sidebar-right-open]{visibility:visible;transform:none}` / `[data-sidebar-right-panel=fullscreen]{z-index:40;border:none;position:fixed;inset:0}` / `.P3OORG_floatHost{z-index:60;pointer-events:none;position:fixed;inset:0}`。

⚠️ **右栏的面板头部/tab 条/分屏/浮动层内部类名在本树中不可读** —— 它们由 `dsh-client-ui-dockkit` 渲染，而该包不在本树（它被打进 shell bundle，其类名即 dist CSS 的 `17p4l` 组，见 §2.2）。

#### `dsh-client-ui-settings-general`（设置面板）—— 4 个模块

| 模块 | 类名 |
|---|---|
| `SettingsRoot.module.css` | `VOzbGW_overlay`(z-index 1000, fixed inset 0) `VOzbGW_mask` `VOzbGW_panel`(800px 宽, `border-radius:32px`) `VOzbGW_nav`(188px 宽) `VOzbGW_navTitle` `VOzbGW_navList` `VOzbGW_navCell` `VOzbGW_navIcon` `VOzbGW_navLabel` `VOzbGW_active` `VOzbGW_content` `VOzbGW_header` `VOzbGW_actions` `VOzbGW_close` `VOzbGW_hiddenLabel` `VOzbGW_options` `VOzbGW_triggerRow` `VOzbGW_trigger` `VOzbGW_railRow` `VOzbGW_rail` `VOzbGW_triggerLabel` |
| `chrome.module.css` | `UQsH_q_triggerLabel` |
| `GeneralSection.module.css` | `_WvWnq_section` |
| `SettingsDocumentAction.module.css` | `me01iq_action` `me01iq_error` |

关键几何（原文）：`.VOzbGW_panel{z-index:1;background:var(--dsw-alias-bg-layer-2);width:800px;max-width:calc(100vw - 48px);height:min(800px,100vh - 48px);box-shadow:var(--dsw-elevation-prominent);border-radius:32px;display:flex;position:relative;overflow:hidden}`

> 注意：`VOzbGW_panel` 的 JSDoc 注释写的是「figma 501:29947, 1080x700」，与实际产出的 `800px / min(800px,100vh-48px)` **不一致**。以 CSS 为准。

⚠️ **设置行本身（label/description/control）不在本包**，由各功能包自绘并注册进 `settings.general.item` 槽。

#### `dsh-client-ui-conversation`（会话骨架 + composer）—— 10 个模块

| 模块 | 类名前缀 | 关键类 |
|---|---|---|
| `skeleton/ConversationRoot.module.css` | `wSkVaW_*` (25) | `root` `header` `headerHidden` `titleRow` `titleCluster` `crumbs` `crumb` `crumbSeg` `crumbSep` `crumbCurrent` `crumbSubagent` `headerActions` `headerUtilities` `headerCorner` `tabs` `tab` `tabActive` `body` `scrollBody` `viewArea` `composerSeat` `composerStack` `composerHero` `heroWorkspaceRow` `widthHandle` |
| `skeleton/InputBar.module.css` | `uV2eYG_*` (22) | **composer**：`root` `hero` `notice` `card` `cardWorkspaceTrigger` `overlayAnchor` `accessory` `scroll` `grow` `input` `inputDisabled` `placeholder` `row` `tools` `add` `modes` `trailing` `primary` `select` `retry` `pending` `input-pending` |
| `skeleton/HeroShell.module.css` | `pXSMma_*` (17) | `root` `body` `stack` `fish` `fishHitbox` `headline` `titleGroup` `workspaceRow` `workspace` `workspaceLabel` `folder` `chevron` `previewBadge` `modalInput` `modalAction` `modalError` `hero-fish-swim` |
| `skeleton/ContextMeter.module.css` | `JObwrW_*` (17) | `root` `trigger` `panel` `header` `headline` `percent` `bar` `track` `fill` `segment` `rows` `row` `swatch` `figures` `colorSystem` `colorMessages` `colorTools` |
| `skeleton/TodoPanel.module.css` | `lXshSW_*` (15) | `root` `header` `title` `lead` `chevron` `progress` `body` `content` `list` `item` `glyph` `glyphPending` `glyphProgress` `glyphCompleted` `todo-progress-spin` |
| `skeleton/PermissionSelect.module.css` | `Sh0Q9G_*` (5) | `trigger` `triggerIcon` `triggerLabel` `chevron` `chevronOpen` |
| `input/editor/ReferenceChip.module.css` | `yAWgPa_*` (5) | `chip` `icon` `label` `marker` `invalid` |
| `input/editor/composer-editor.module.css` | `q44v1G_textRef` | 输入框内的文本引用装饰 |
| `input/queue/QueueDock.module.css` | `_7yHdaG_*` (20) | `dock` `panel` `header` `list` `row` `pendingRow` `preview` `editor` `action` `actions` `attachments` `chevron` `count` `file` `fileIcon` `fileName` `fileSize` `lead` `status` `thumb` |
| `settings/EnterBehaviorRow.module.css` | `T1PP_q_*` (6) | `row` `rowText` `title` `desc` `selector` `chevron` |

composer 关键几何（原文，`ConversationRoot.module.css` / `InputBar.module.css`）：
```css
.wSkVaW_root{background:var(--dsw-alias-bg-base);
  --dsh-chat-content-width:var(--dsh-chat-user-width,clamp(680px, calc(var(--dsh-conversation-column-width,0px) * .64), 920px));
  --dsh-composer-card-max-width:calc(var(--dsh-chat-content-width) + 32px);
  --dsh-composer-side-clearance:16px;--dsh-composer-dock-inset:8px;…}
.uV2eYG_card{max-width:var(--dsh-composer-card-max-width);--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);
  background:var(--dsw-specific-input-major);box-shadow:var(--dsw-elevation-soft);border:0;border-radius:22px;
  flex-direction:column;gap:12px;padding-top:8px;display:flex;position:relative}
.uV2eYG_input{min-height:36px;color:var(--dsw-alias-label-primary);caret-color:var(--dsw-alias-state-business-primary);outline:none;padding:4px 8px 0 14px}
.uV2eYG_row{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;padding:2px 8px 6px;display:flex;container-type:inline-size}
.uV2eYG_primary{background:var(--dsw-alias-button-info-fill);color:#fff;border-radius:999px;width:34px;height:34px;transform:translateY(-2px)}
.uV2eYG_add{background:var(--dsw-specific-selector);width:28px;height:28px;border-radius:999px}
```

> composer 的文本输入**不是 `<textarea>`**，而是 Lexical 驱动的 `contenteditable` div（`<div class="uV2eYG_input" role="textbox" aria-multiline="true" data-composer-input>`）。

#### `dsh-client-ui-chat`（消息流 + markdown）—— 16 个模块

| 模块 | 类名前缀 | 关键类 |
|---|---|---|
| `chat/ChatView.module.css` | `EvIC1a_*` (14) | `root` `scroll` **`column`**（`data-chat-flow`）`flowItem` `callRow` `turnStatus` `turnStatusClock` `hint` `openError` `older` `toBottomSlot` `toBottom` `modalAction` `dsh-turn-status-shimmer` |
| `chat/MessageItem.module.css` | `Sixlwa_*` (33) | `userRow` `userStack` **`bubble`** `attachmentRow` `fileCard` `fileIcon` `fileContent` `fileName` `fileMeta` `contextRow` `referenceSummary` `compactionRow` `compactionButton` `compactionTitle` `compactionSummary` `compactionBody` `compactionLeading` `compactionContextIcon` `compactionDisclosureIcon` `compactionSep` `retryRow` `retrySummary` `retryText` `retryDetails` `retryDetailLabel` `retry-shimmer` `turnErrorRow` `turnErrorDot` `turnErrorCopy` `turnErrorTitle` `turnErrorMessage` `turnErrorCode` `maxTokensTitle` |
| `chat/TurnNavigator.module.css` | `eGxaPq_*` (18) | `slot` `frame` `scroller` `marks` `mark` `markActive` `markBusy` `markUnloaded` `markPosition` `markPreview` `preview` `previewPrompt` `previewResponse` `fadeTop` `fadeBottom` `dsh-turn-mark-busy` `dsh-turn-mark-enter` `dsh-turn-preview-enter` |
| `chat/ReasoningRow.module.css` | `lcKema_*` (10) | `root` `row` `leading` `title` `summary` `summaryText` `chevron` `separator` `thinkBody` `dsh-reasoning-row-sweep` |
| `chat/AssistantMarkdown.module.css` | `hWmORq_*` (4) | `root` `body` `actions` `stopped`（全局类 `.md-table-wide` 在此模块） |
| `chat/GenericCommandCard.module.css` | `_5OnbHa_*` (9) | `root` `row` `leading` `title` `summary` `chevron` `separator` `body` `dsh-command-row-sweep` |
| `chat/ContextBody.module.css` | `ZkiH0q_*` (23) | `text` `sections` `section` `sectionName` `sectionText` `entries` `entry` `entryName` `entryDescription` `fields` `field` `fieldKey` `fieldValue` `files` `file` `filePath` `fileAction` `recalls` `recall` `recallLabel` `recallCounts` `relaySender` `catalogNotice` |
| `chat/ContextInjectionRow.module.css` | `XrJvXW_*` (6) | `root` `summary` `source` `chevron` `sep` `body` |
| `chat/MessageIconActions.module.css` | `xzv4MW_*` (5) | `actions` `action` `timeStart` `timeEnd` `visuallyHidden` |
| `chat/TurnProcessNodeView.module.css` | `l_V-RG_*` (3) | `root` `label` `chevron` |
| `chat/TurnUsagePanel.module.css` | `Q51KRG_*` (3) | `root` `trigger` `label` |
| `chat/stat-dialog.module.css` | `bRhRbq_*` (8) | `panel` `title` `titleLabel` `titleValue` `titleRule` `route` `reasoning` `details`（portal 到 body，`role="dialog"`） |
| `chat/TurnTailNodeView.module.css` | `TS9iAW_*` (2) | `root` `actions` |
| `chat/StatsPills.module.css` | `bOPqQW_*` (5) | `root` `anchor` `pill` `label` `sep` |
| `chat/accessibility.module.css` | `TTCZqG_visuallyHidden` | 屏读 |
| `settings/TranscriptViewRow.module.css` | `lats3W_*` (6) | `row` `rowText` `title` `desc` `selector` `chevron` |

`ChatView.module.css` 关键原文：
```css
.EvIC1a_scroll{min-height:0;padding:16px calc(var(--dsh-composer-side-clearance) + 16px);flex:auto;overflow-y:auto;container-type:inline-size}
[data-conversation-scroll] .EvIC1a_root{flex:none;height:auto;min-height:auto}
[data-conversation-scroll] .EvIC1a_scroll{flex:none;min-height:auto;overflow:visible}
.EvIC1a_column{max-width:var(--dsh-chat-content-width);flex-direction:column;width:100%;margin:0 auto;display:flex}
.EvIC1a_column>:not([hidden]):not(.EvIC1a_flowItem:empty)~:not([hidden]):not(.EvIC1a_flowItem:empty){margin-top:var(--dsh-chat-flow-gap,16px)}
.EvIC1a_flowItem[data-turn-process-answer]{--dsh-chat-flow-gap:8px}
```
用户气泡：`.Sixlwa_userStack{max-width:min(calc(var(--dsh-chat-content-width,748px) * .702), 82%);flex-direction:column;align-items:flex-end;gap:8px;display:flex}` / `.Sixlwa_bubble{background:var(--dsw-specific-bubble);max-width:100%;font-size:var(--dsh-content-font-size,14px)}`

#### `dsh-client-ui-tool`（工具调用卡）—— 4 个模块

| 模块 | 类名前缀 | 关键类 |
|---|---|---|
| `tool/components/ToolRow.module.css` | `o3BgMG_*` (31) | `root` `row` `leading` `title` `chevron` `sep` `summary` `summarySuffix` `fileLink` `diffStat` `errorSummary` `bodyWrap` `bodyScroll` `ioCard` `ioSection` `ioDivider` `ioLabel` `ioText` `inspectButton` `codeBody` `terminalBody` `diffBody` `readBody` `imageBody` `imageLabel` `imageMeta` `searchBody` `searchRecovery` `webBody` `visuallyHidden` `dsh-tool-row-sweep` |
| `tool/ToolCallTree.module.css` | `ztWv_q_*` (2) | `callRow` `subCalls` |
| `tool/components/AskQuestionCard.module.css` | `fsXYAq_*` (9) | `card` `item` `question` `answer` `answerLine` `skipped` `verdict` `questionList` `unansweredQuestion` |
| `tool/toolviews/bash-sample.module.css` | `CY-8Ka_*` (20) | `card` `root` `terminal` `ioCard` `ioSection` `ioDivider` `ioLabel` `ioText` `leading` `title` `sep` `summary` `errorSummary` `chevron` `chevronHover` `iconIdle` `bodyWrap` `inspectButton` `visuallyHidden` `dsh-bash-row-sweep` |

工具行根节点的属性（`dsh-client-ui-tool/lib/client.js:1254-1258`）：
```js
className: ToolRow_module_css_default.root,
"data-variant": variant,      // 'search'|'read'|'bash'|'write'|'edit'|'code'|'others'
"data-tool": toolName,        // 线上工具名，如 "pwsh" / "read_file" / "cordis_define"
"data-state": state,          // 'running'|'ok'|'error'|'stopped'
```
类型定义（`lib/types/client/tool/models/tool-call-model.d.ts:12-14`）：
```ts
export type ToolRowVariant = 'search' | 'read' | 'bash' | 'write' | 'edit' | 'code' | 'others';
export type ToolRowState = 'running' | 'ok' | 'error' | 'stopped';
```
CSS 里对工具名的钩子（原文，`ToolRow.module.css`）：
```css
.o3BgMG_root[data-state=running] .o3BgMG_row:after{ /* 2.6s 扫光动画 */ }
.o3BgMG_root[data-tool^=cordis_] .o3BgMG_leading,
.o3BgMG_root[data-tool^=cordis_] .o3BgMG_title{color:var(--dsw-alias-state-business-primary)}
.o3BgMG_root[data-tool^=cordis_] .o3BgMG_title{font-weight:500}
.o3BgMG_root[data-tool^=cordis_] .o3BgMG_sep{background:var(--dsw-alias-state-business-primary)}
.o3BgMG_ioText[data-error]{color:var(--dsw-alias-state-error-primary)}
```
`bash-sample` 的根还带 `data-sample="bash"`、`data-expandable`、`role="button"`、`tabIndex`、`aria-expanded`。

#### `dsh-client-ui-theme`（设置里的外观行）—— 2 个模块

| 模块 | 类名 |
|---|---|
| `client/AppearanceRow.module.css` | `_8HJdBW_group` `_8HJdBW_title` `_8HJdBW_cubeRow` `_8HJdBW_themeCube` `_8HJdBW_selected` |
| `client/FontSizeRow.module.css` | `bVCLcG_row` `bVCLcG_rowText` `bVCLcG_title` `bVCLcG_desc` `bVCLcG_control` `bVCLcG_stepper` `bVCLcG_value` `bVCLcG_unit` `bVCLcG_arrows` `bVCLcG_arrow` |

原文：`. _8HJdBW_group{border-bottom:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;padding:16px 0;display:flex}` / `.bVCLcG_row{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}`

**设置行的通用形状（照这个写你自己的行）：**
```
div.<module>_group|row          ← border-bottom:.5px + padding:16px 0
├ div.<module>_title            ← 行标题 font-size:14px;line-height:22px
├ div.<module>_desc             ← 行描述 color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px
└ div.<module>_control          ← 控件容器 display:inline-flex
```

---

## 3. DOM 结构骨架

### 3.1 文档级

```html
<html lang="en" style="color-scheme: light|dark">          <!-- colorScheme 由 presenter/boot 写 -->
  <head>
    <!-- 6 张 theme 样式表 + 每个 CSS module 一张，均带 data-plugin / data-plugin-css -->
    <meta name="theme-color" content="<computed body background>">   <!-- presenter 单一持有 -->
    <style data-plugin="@deepseek-ai/dsh-client-ui-theme"
           data-plugin-css="@deepseek-ai/dsh-client-ui-theme/base.css">…</style>
    …
  </head>
  <body style="--dsh-content-font-size: 14px"                <!-- 由 presenter / boot 写 -->
        data-ds-dark-theme>                                  <!-- 仅暗色时存在，空值 -->
    <div id="root">…</div>
    <!-- createPortal 目标：Toast、Modal/Dialog、右栏浮动层 -->
  </body>
</html>
```

`body` 自身的基线样式（dist CSS 尾部原文）：
```css
html,body,#root{height:100%;margin:0}
body{font-family:var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", …);
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;
  color:var(--dsw-alias-label-primary, #0f1115);background:var(--dsw-alias-bg-base, #fff);text-autospace:normal}
code,pre,[data-diff],[data-read],[data-search],[data-terminal]{text-autospace:no-autospace}
button,input,select,textarea{font-family:inherit}
```

### 3.2 `#root` 内部（关键：`#root` **就是** React 容器，中间没有包装 div）

> 下面树中的记法：`attr?` 表示该属性**条件存在**；`[class]` 表示条件附加的类；`…` 表示内容省略。属性值为空的布尔标记（如 `data-dsh-boot`、`data-composer-seat`）在产物中就是空串属性。

shell 启动（`index-DuF6ti6g.js` 末尾原文）：
```js
const Cu=document.getElementById("root");if(Cu===null)throw new Error("web app: missing #root");new Iy(Cu).run();
```
boot 页 `new by(t)` 直接把 `div._boot_1fywu_3` append 进 `#root`。

挂载（`dsh-client-ui-renderer/lib/client.js`，`mountApp`）：
```js
const boot = container.querySelector(":scope > [data-dsh-boot]");
if (boot !== null) return hydrateRoot(container, createElement(BootHandoff, { app, boot: { className: boot.className, html: boot.innerHTML } }));
const root = createRoot(container);
```
`BootHandoff` 首个 layout effect 后返回 `props.app()`，即用 React 树替换掉 loading DOM。

```html
<div id="root">
  <!-- 阶段 1：加载页（纯 DOM，非 React；由 shell 的 boot page 类构造） -->
  <div class="_boot_1fywu_3" data-dsh-boot>
    <div class="_card_1fywu_26">
      <div class="_wordmark_1fywu_33">HARNESS</div>
      <div class="_spinner_1fywu_47" data-dsh-boot-spinner style="--dsh-boot-arc:…deg"></div>
      <div class="_hint_1fywu_41">Loading plugins…</div>
    </div>
    <!-- 失败时：div._failed_1fywu_74 > (._failedTitle_1fywu_81 + ._failedItem_1fywu_88*) -->
  </div>

  <!-- 阶段 2：应用（同一位置被 React 接管） -->
  <div class="pI_x6G_frame" style="grid-template-columns: 280px minmax(0, 1fr) 0px"
       data-sidebar-collapsed? data-rightbar-collapsed? data-rightbar-fullscreen?
       data-rightbar-instant? data-dragging?>

    <!-- 左列 ------------------------------------------------------------ -->
    <div class="pI_x6G_sidebarCol">
      <div class="hHd-Xa_root [hHd-Xa_collapsed] [hHd-Xa_railIn] [hHd-Xa_fading] [hHd-Xa_quietBars]"
           style="width: 280">        <!-- 宽度由 JS 内联；style 仅在 wide 时存在 -->
        <div class="hHd-Xa_logoRow">
          <button class="hHd-Xa_brand [hHd-Xa_wide]">
            <span class="hHd-Xa_brandIdentity">
              <span class="hHd-Xa_brandMark" data-slot="sidebar.brand.mark">…</span>   <!-- 默认 FishLogo -->
              <span class="hHd-Xa_brandName" data-slot="sidebar.brand.name">…</span>
            </span>
          </button>
          <button class="hHd-Xa_iconButton hHd-Xa_toggle">          <!-- 折叠/展开 -->
            <span class="hHd-Xa_railMark">…</span>
            <span class="hHd-Xa_panelIcon">…</span>
          </button>
        </div>
        <button class="hHd-Xa_newSession"><span class="hHd-Xa_newSessionLabel [wide]">…</span></button>
        <div class="hHd-Xa_panelList" data-slot="sidebar.panellist">…</div>
        <div class="hHd-Xa_regionArea" data-slot="sidebar.workspaces">
          <!-- ui-workspace WorkspaceBrowser: -->
          <div class="bhn1Oq_root [bhn1Oq_rail]">
            <div class="bhn1Oq_sectionHeader">… 搜索框 / 视图切换 / 新建工作区 …</div>
            <div class="bhn1Oq_listArea">
              <div class="bhn1Oq_treeBody bhn1Oq_wide">
                <div class="bhn1Oq_list" role="tree">      <!-- 或 bhn1Oq_flatList -->
                  <div class="bhn1Oq_groupSection">
                    <div class="YDXeBa_projectRow" role="treeitem" draggable>…</div>
                    <div class="YDXeBa_sessionRow [YDXeBa_selected]" role="treeitem" aria-selected>
                      <span class="YDXeBa_slot">…状态点…</span>
                      <span class="YDXeBa_title">…</span>
                      <span class="YDXeBa_time">…</span>
                      <span class="YDXeBa_rowActions">…</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="hHd-Xa_footArea">
          <div class="hHd-Xa_footerActions" data-slot="sidebar.footer.action">…</div>
          <div class="hHd-Xa_settingsArea" data-slot="sidebar.settings">…</div>
        </div>
      </div>
    </div>

    <!-- 中列 ------------------------------------------------------------ -->
    <div class="pI_x6G_centerCol">
      <div class="wSkVaW_root" data-phase="blank|hero|active|settling">
        <header class="wSkVaW_header [wSkVaW_headerHidden]" data-slot="conversation.session.header">
          <div class="wSkVaW_titleRow">
            <div class="wSkVaW_titleCluster">
              <div class="wSkVaW_crumbs"><div class="wSkVaW_crumbSeg">…</div>
                <button class="wSkVaW_crumb [wSkVaW_crumbCurrent] [wSkVaW_crumbSubagent]">…</button></div>
            </div>
            <div class="wSkVaW_headerActions"  data-slot="conversation.session.header.actions">…</div>
            <div class="wSkVaW_headerUtilities" data-slot="conversation.session.header.utilities">…</div>
            <div class="wSkVaW_headerCorner" data-conversation-header-corner
                 data-slot="conversation.session.header.corner">…</div>
          </div>
          <div class="wSkVaW_tabs">
            <button class="wSkVaW_tab [wSkVaW_tabActive]">…</button>
          </div>
        </header>

        <div class="wSkVaW_body">
          <div class="wSkVaW_scrollBody" data-conversation-scroll>
            <div class="wSkVaW_viewArea" data-slot="conversation.view">
              <!-- ui-chat ChatView -->
              <div class="EvIC1a_root">
                <div class="EvIC1a_scroll">
                  <div class="EvIC1a_slot">…轮次导航轨 eGxaPq_* …</div>
                  <div class="EvIC1a_column" data-chat-flow>
                    <div class="EvIC1a_flowItem"
                         data-chat-anchor-key data-chat-flow-key data-chat-flow-kind
                         data-chat-turn data-turn-process-member? data-turn-process-hidden?
                         data-turn-process-answer?>
                      <!-- 用户消息 -->
                      <div class="Sixlwa_userRow">…</div>
                      <!-- 助手 markdown -->
                      <div class="hWmORq_root"><div class="hWmORq_body">
                        <div class="_markdown_kcgor_5">…markdown 输出…</div>
                      </div></div>
                      <!-- 工具调用 -->
                      <div class="o3BgMG_root" data-variant data-tool data-state>
                        <span class="o3BgMG_visuallyHidden">…</span>
                        <div class="_root_luwio_9"><div class="_row_luwio_16">
                          <span class="_leading_luwio_29">…</span>
                          <span class="_title_luwio_79">…</span>
                          <span class="_chevron…"></span>
                        </div></div>
                        <div class="o3BgMG_bodyWrap">
                          <div class="o3BgMG_codeBody">…</div>   <!-- 或 terminalBody/diffBody/readBody/
                                                                       imageBody/searchBody/webBody/bodyScroll -->
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="EvIC1a_toBottomSlot"><button class="EvIC1a_toBottom">…</button></div>
                </div>
                <div class="tooltip bubble span (portal)"></div>
              </div>
            </div>

            <div class="wSkVaW_composerSeat" data-composer-seat>
              <div class="wSkVaW_composerStack [wSkVaW_composerHero]">
                <div class="pXSMma_root">…hero…</div>
                <div class="wSkVaW_heroWorkspaceRow">…</div>
                <div class="uV2eYG_root [uV2eYG_hero]">            <!-- InputBar -->
                  <div class="uV2eYG_card" data-composer-card>
                    <div class="uV2eYG_overlayAnchor" data-slot="conversation.input.overlay">…</div>
                    <div class="uV2eYG_accessory">…</div>
                    <div data-slot="conversation.input.attachments">…chips…</div>
                    <div class="uV2eYG_scroll" data-input-scroll>
                      <div class="uV2eYG_grow">
                        <div class="uV2eYG_input" contenteditable role="textbox" aria-multiline="true"
                             data-composer-input data-phase="inert|…" data-placeholder="…">…</div>
                        <div class="uV2eYG_placeholder" aria-hidden data-composer-placeholder>…</div>
                      </div>
                    </div>
                    <div class="uV2eYG_row">
                      <div class="uV2eYG_tools">
                        <button class="uV2eYG_add">＋</button>
                        <button class="uV2eYG_add">📎</button>
                        <input type="file" hidden multiple>
                        <div class="uV2eYG_modes">…</div>
                      </div>
                      <div class="uV2eYG_trailing">
                        <span data-slot="conversation.input.model">…</span>
                        <div class="JObwrW_root">…ContextMeter…</div>
                        <button class="uV2eYG_primary">↑</button>   <!-- 发送/停止 -->
                      </div>
                    </div>
                  </div>
                  <div data-slot="conversation.composer.dock">…</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 仅 data-phase="active" 时存在 -->
        <div class="wSkVaW_widthHandle" data-side="left"  data-width-handle="left"></div>
        <div class="wSkVaW_widthHandle" data-side="right" data-width-handle="right"></div>
      </div>
    </div>

    <!-- 右列 ------------------------------------------------------------ -->
    <div class="pI_x6G_rightbarCol" data-rightbar-col>
      <div class="P3OORG_panel" data-sidebar-right-panel="push|fullscreen"
           data-sidebar-right-open? aria-hidden? style="width:…">
        <div class="P3OORG_panelBody">
          <!-- DockSurface（dockkit，类名见 dist CSS 17p4l 组）：
               div._surface_17p4l_125[data-dockkit-surface][data-dockkit-drop-zones]
                 └ pane / tabStrip / tab / slot / paneBody / float / dockHint … -->
        </div>
      </div>
    </div>

    <!-- 帧级浮层（永远存在，可点击穿透） ---------------------------------- -->
    <div class="pI_x6G_overlayLayer" data-shell-overlay>
      <div data-slot="shell.overlay">…</div>
    </div>

    <!-- 列宽把手（条件渲染） -->
    <div class="pI_x6G_handle" data-side="sidebar"  data-dragging? style="left:280px"></div>
    <div class="pI_x6G_handle" data-side="rightbar" data-dragging? style="left:…px"></div>
  </div>
</div>
```

**body 级 portal 挂载点（三个）：**

```html
<body>
  <div id="root">…</div>

  <!-- ① Toast：shell 单例 -->
  <div class="_toast_e5v0f_6" role="alert" style="left:…px; --dsh-toast-hold:3000ms">
    <span class="_icon_e5v0f_37" aria-hidden>…</span>
    <span class="_text_e5v0f_44">…</span>
  </div>

  <!-- ② Modal / Dialog / 统计面板（primitives + ui-chat） -->
  <div class="_root_w1urq_2" role="presentation">
    <div class="_mask_w1urq_14" aria-hidden></div>
    <div class="_dialog_w1urq_22" role="dialog" aria-modal="true" aria-label="…">
      <div class="_content_w1urq_37"><div class="_header_w1urq_45">…</div>…</div>
    </div>
  </div>

  <!-- ③ 右栏浮动层 -->
  <div class="P3OORG_floatHost" data-sidebar-right-float-host>…</div>
</body>
```

### 3.3 槽位包装器 `<div data-slot="…">`

**每个槽位渲染点都会产出一个包装 div**（`dsh-client-ui-renderer/lib/client.js`）：

```js
const ANCHOR_STYLE = { display: "contents" };   // 稳定引用，永不 diff
return jsx("div", { "data-slot": slotKey, style: ANCHOR_STYLE, children: renderOutletContent(...) });
```

- `display:contents` ⇒ **对布局零影响**（不产生盒子），但仍是可命中的属性钩子。
- 崩溃条目会渲染 `<div data-slot-error="<slotKey>">` 而不是内容。

---

## 4. 可注入的扩展点

### 4.1 `[data-slot="…"]` —— 最稳的钩子（推荐优先使用）

因为 `display:contents`，你可以放心把它当纯选择器锚点：

```css
[data-slot="conversation.composer.bar"]  > * { … }
[data-slot="settings.general.item"]      { … }
[data-slot="shell.overlay"]              { … }
```

`settings-general` 的 `GeneralSection.module.css` 就是这么用的（原文）：
`._WvWnq_section>[data-slot="settings.general.item"]>:last-child{border-bottom:none}`

### 4.2 完整槽位清单（全树 grep 结果 + `dsh-cordis-client-runner` 发布清单交叉验证）

**布局根（`dsh-client-ui-layout` 声明）：** `root`（内置，shell 渲染它）、`sidebar`（single/root，被 ui-sidebar 的 SidebarRoot 占用）、`main`（keyed/root，保留键 `conversation`）、`rightbar`（single/root，被 ui-sidebar-right 占用）、`shell.overlay`（list/root，帧级浮层，**任何人都可以往里加东西**）。

> **发现：`dsh-client-ui-cordis/lib/client.js` 里内嵌了整份已发布客户端 composition 的槽位清单**（它是运行时的 client runner，把全部插件 id 与槽位名当字符串常量列了出来）。上表与下表都经它与各包源码双向核对。

**全部具名槽位：**

| 域 | 槽位名 |
|---|---|
| 侧栏 | `sidebar` `sidebar.brand.mark` `sidebar.brand.name` `sidebar.panellist` `sidebar.workspaces` `sidebar.workspaces.directoryFlow` `sidebar.footer.action` `sidebar.settings` |
| 右栏 | `rightbar` `rightbar.session` `sidebar.right.pane.tab` `sidebar.right.pane.tab.title` `sidebar.right.tab.menu.item` `sidebar.right.tab.document` `sidebar.right.tab.guide` |
| 会话骨架 | `main` `main.conversation` `conversation.session` `conversation.session.header` `conversation.session.header.actions` `conversation.session.header.utilities` `conversation.session.header.corner` `conversation.session.header.lineage` `conversation.view` |
| 消息流 | `conversation.chat.node` `conversation.chat.commandview` `conversation.chat.assistant-actions` `conversation.chat.turnTail` `conversation.message.images` `conversation.trajectory.images` `conversation.approval.detail` |
| Hero | `conversation.hero.brand.mark` `conversation.hero.workspace` `conversation.hero.workspace.directoryFlow` `conversation.hero.agentPreset` |
| Composer | `conversation.composer`（**chain kind**）`conversation.composer.bar` `conversation.composer.dock` `conversation.input.attachments` `conversation.input.overlay` `conversation.input.left` `conversation.input.right` `conversation.input.model` `conversation.input.plan` `conversation.input.dock` |
| 工具 | `tool.call.toolview`（**keyed，key = 线上工具名**；未认领的 key 回落到通用工具行；认领已发布 key 即为接管） `tool.call.images` |
| 设置 | `settings.trigger` `settings.header` `settings.action` `settings.close` `settings.section` `settings.general.item` `settings.plugins.tab` `settings.plugin.item` `settings.onboarding` |
| 其它 | `dsh.trajectory.duration` |

**已发布条目的 id / order（可用来判断插入位置）：**

| 槽位 | id | order | 声明者 |
|---|---|---|---|
| `settings.general.item` | `appearance` | 10 | `dsh-client-ui-theme` |
| `settings.general.item` | `font-size` | 11 | `dsh-client-ui-theme` |
| `settings.general.item` | `transcript-view` | 12 | `dsh-client-ui-chat` |
| `settings.general.item` | (语言行) | 未找到 | `dsh-client-locale` |
| `settings.general.item` | (Enter 行为行) | 未找到 | `dsh-client-ui-conversation` |
| `settings.general.item` | (权限预设行) | 未找到 | `dsh-client-ui-permission-presets` |
| `settings.section` | `general` | 0 | `dsh-client-ui-settings-general` |
| `settings.action` | `open-document` | 0 | `dsh-client-ui-settings-general` |
| `conversation.view` | `chat` / `trajectory` | 未找到 | `ui-chat` / `ui-trajectory` |
| `conversation.composer.dock` | `stats` | 未找到 | `dsh-client-ui-chat` |
| `sidebar.right.pane.tab` | `GUIDE_ID` | 未找到 | `dsh-client-ui-sidebar-right` |

**槽位使用规则（源码里的硬约束，违反会抛错）：**

```js
// dsh-client-ui-renderer/lib/client.js:283-292  —— 所有 renderSlot 都经过这里
binding = (key, owner, opts) => {
  if (!host.isLive(entry)) throw new StaleAuthorizationError(`renderSlot('${key}') from a disposed registration`);
  const declared = entry.children?.[key];
  if (declared === void 0) throw new SlotOwnershipError(`slot '${key}' is not declared by this entry's children`);
  if (declared.kind === "chain") throw new SlotOwnershipError(`slot '${key}' is declared 'chain' — use renderSlotChain`);
  return jsx(SlotOutlet, { slotKey: key, ownerProps: owner, opts });
};
```

- 只有**声明了 `children`** 的注册才能渲染该子槽位（声明 = 独占渲染权）。
- `kind: "chain"` 的槽位（目前只有 `conversation.composer`）必须用 `renderSlotChain`。
- 每个槽位渲染点都会产出 `<div data-slot="…" style="display:contents">`（见 §3.3）。


### 4.3 Portal 挂载点

| 目标 | 内容 | 证据 |
|---|---|---|
| `document.body` | Toast（`role="alert"`，`--dsh-toast-hold` 内联） | `createPortal(a.jsxs("div",{className:Yl.toast,role:"alert",style:{…,"--dsh-toast-hold":…}}),document.body)` |
| `document.body` | Modal / Dialog（`Ut.root/mask/dialog`，Escape 关闭） | `T1.createPortal(a.jsxs("div",{className:Ut.root,role:"presentation",children:[…Ut.mask…,…Ut.dialog,role:"dialog","aria-modal":"true"…]}),document.body)` |
| `document.body` | ui-chat 统计对话面板 ×3（`role="dialog"`，类 `bRhRbq_panel`） | `createPortal(…, document.body)`（`ui-chat/lib/client.js:3510, 3982, 4040`） |
| `document.body` | 右栏浮动层 `P3OORG_floatHost[data-sidebar-right-float-host]` | `createPortal(jsx("div",{className:…floatHost,"data-sidebar-right-float-host":true,…}),document.body)` |
| `document.body` | 图片灯箱 `fNh4Da_*`（attachment 包） | `ImageLightbox` |
| `document.head` | `<style data-plugin-css="…">` × N | 每个 CSS module 一个 |
| `document.head` | `<meta name="theme-color">` × 1 | ThemePresenter |
| `#root` | boot 页 + React 应用 | `hydrateRoot(container, …)` / `createRoot(container)` |
| **contenteditable 内部** | composer 装饰器/chip | `createPortal(jsx, editor.getElementByKey(key), key)`（`ui-conversation/lib/client.js:15194`） |

**菜单/悬浮卡的 portal**：primitives 的 `<Menu portal>` / `<HoverCard>` / `<Tooltip>` 会自行 portal（源码在 shell bundle 中，`_root_1nxmc_1`/`_portal_1nxmc_44` 与 `_bubble_1nw3t_1`）。Tooltip 用绝对定位 + 内联 `left/top/maxWidth`：

```js
jsx("span",{ref:k,className:Vf.bubble,"data-side":x,style:{left:g.x,top:b,…},role:"tooltip",children:_})
```

### 4.4 `data-*` 标记属性总表

| 属性 | 所在节点 | 取值 | 来源 |
|---|---|---|---|
| `data-ds-dark-theme` | `<body>` | 存在（空值）/ 不存在 | theme boot + layout presenter |
| `data-dsh-boot` | `#root > div` | 空 | shell boot page |
| `data-dsh-boot-spinner` | boot spinner | 空 | shell boot page |
| `data-slot` | 任意槽位包装 div | 槽位名 | renderer |
| `data-slot-error` | 槽位包装 div（崩溃时） | 槽位名 | renderer |
| `data-sidebar-collapsed` | `.pI_x6G_frame` | 空 | AppFrame |
| `data-rightbar-collapsed` | `.pI_x6G_frame` | 空 | AppFrame |
| `data-rightbar-fullscreen` | `.pI_x6G_frame` | 空 | AppFrame |
| `data-rightbar-instant` | `.pI_x6G_frame` | 空 | AppFrame |
| `data-dragging` | `.pI_x6G_frame` / `.pI_x6G_handle` / `.wSkVaW_widthHandle` | 空 | AppFrame / ConversationRoot |
| `data-side` | `.pI_x6G_handle` | `sidebar` \| `rightbar`（拖拽把手）；`left` \| `right`（宽度把手） | AppFrame / ConversationRoot |
| `data-rightbar-col` | `.pI_x6G_rightbarCol` | `true`（React 渲染为 `"true"`） | AppFrame |
| `data-shell-overlay` | `.pI_x6G_overlayLayer` | `true` | AppFrame |
| `data-sidebar-right-panel` | `.P3OORG_panel` | `push` \| `fullscreen` | ui-sidebar-right |
| `data-sidebar-right-open` | `.P3OORG_panel` | 空（展开时存在） | ui-sidebar-right |
| `data-sidebar-right-float-host` | `P3OORG_floatHost` | `true` | ui-sidebar-right |
| `data-sidebar-right-mode` / `-toggle` / `-expand` / `-unavailable` / `-guide` / `-guide-entry` | 右栏按钮与 guide | 见 §2.3 | ui-sidebar-right |
| `data-dockkit-surface` / `data-dockkit-drop-zones` | `._surface_17p4l_125` | `horizontal` 等 | dockkit |
| `data-dockkit-strip-scroll` / `data-dockkit-tab-clipped` / `data-dockkit-dock-zone` / `data-dockkit-drop-active` | dockkit 内部 | `start`/`end`/`"start end"`；`top`/`bottom`/`left`/`right`/`center` | dockkit |
| `data-phase` | `.wSkVaW_root` | `blank` \| `hero` \| `active` \| `settling` | ui-conversation |
| `data-conversation-scroll` | `.wSkVaW_scrollBody` | 空 | ui-conversation |
| `data-composer-seat` | `.wSkVaW_composerSeat` | 空 | ui-conversation |
| `data-conversation-header-corner` | `.wSkVaW_headerCorner` | 空 | ui-conversation |
| `data-composer-card` | `.uV2eYG_card` | `true` | ui-conversation |
| `data-composer-input` | `contenteditable` | `true` | ui-conversation |
| `data-composer-placeholder` | 占位 div | `true` | ui-conversation |
| `data-placeholder` | `contenteditable` | 占位文本 | ui-conversation |
| `data-input-scroll` | `.uV2eYG_scroll` | `true` | ui-conversation |
| `data-composer-chip` | composer 内 chip 元素 | chip 来源 | Lexical decorator |
| `data-composer-text-ref` | 文本引用装饰 | 空 | composer-editor |
| `data-queue-dock` / `data-submission-echo` | 排队区 | 空 | ui-conversation |
| `data-lexical-*` | contenteditable 内部 | `data-lexical-editor` `data-lexical-text` `data-lexical-decorator` `data-lexical-slot` `data-lexical-cursor` `data-lexical-indent` `data-lexical-managed-linebreak` | Lexical |
| `data-chat-flow` | `.EvIC1a_column` | 空 | ui-chat |
| `data-chat-anchor-key` / `data-chat-flow-key` / `data-chat-flow-kind` / `data-chat-turn` | `.EvIC1a_flowItem` | key / 节点 kind / 轮次号 | ui-chat |
| `data-turn-process-member` / `-hidden` / `-answer` | `.EvIC1a_flowItem` | 空 | ui-chat |
| `data-composer-stats` | composer 内 | `true` | ui-chat |
| `data-composer-placeholder` / `data-error`（ioText） | 见上 | — | — |
| `data-variant` / `data-tool` / `data-state` | `.o3BgMG_root` | 见 §2.3（`data-tool` 是**线上工具名字符串**） | ui-tool |
| `data-expandable` / `data-sample` | `.CY-8Ka_root` | `bash` 等 | ui-tool |
| `data-error` | `.o3BgMG_ioText` | 空 | ui-tool |
| `data-terminal` | `._block_1gdtu_1` | 空 | shell bundle 工具视图 |
| `data-read` | `._block_onbk6_1` | 空 | 同上 |
| `data-diff` | `._block_12o37_1` | 空 | 同上 |
| `data-search` | `._block_1h7p4_1` | 搜索 kind | 同上 |
| `data-web` | `._block_19q7d_1` | `search` \| `fetch` | 同上 |
| `data-running` | `.o3BgMG_root` 之外的 terminal 行 | 空 | 同上 |
| `data-ref-chip` | `.Er.refChip` | `session` \| `file` \| `folder` | shell markdown |
| `data-json-root-row` / `data-json-copy-active` | JSON 树行 | 空 | shell bundle |
| `data-state` | `._dot_1tljr_3`（StateDot） | `done` \| `warning` \| `error` \| `idle` \| `ongoing` | shell bundle |
| `data-tone` | `.d7.tag` | `outline`(默认) \| `solid` \| `neutral` \| `quiet` \| `success` \| `info` \| `warning` \| `danger` | shell primitives |
| `data-side` | `.Vf.bubble`（tooltip） | `top` \| `right` \| `bottom` … | shell primitives |
| `data-state` | `.o3BgMG_root` / `._block*` 等 | 见各条 | — |

### 4.5 主题 API 扩展点

见 §1.17。最小可用片段：

```js
// 注册一个第三方主题
const dispose = ctx.theme.register({
  id: 'my-theme',
  colorScheme: 'dark',
  tokens: {
    '--dsw-alias-bg-base': '#0b0d12',
    '--dsw-alias-label-primary': '#e8eaf0',
  },
});
ctx.theme.setTheme('my-theme');       // 立刻生效

// 不改注册表，只叠一层 token 覆写（后调用者按 token 取胜）
ctx.theme.overrideTokens('my-plugin', {
  '--dsw-alias-brand-primary': { light: '#4d6bfe', dark: '#7b93ff' },  // 必须成对
});
```

> 覆写被写成 **`body` 的内联 CSS 变量**（`body.style.setProperty(name, value)`）。内联样式优先级高于任何样式表，**所以你写在样式表里的同名变量会被它盖掉**。

### 4.6 样式注入约定（照抄即可与框架共存）

```js
const PLUGIN_ID = '@your/plugin';
const tagId = `${PLUGIN_ID}/YourComponent.module.css`;
if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) === null) {
  const tag = document.createElement('style');
  tag.dataset.plugin = PLUGIN_ID;
  tag.dataset.pluginCss = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
}
```

正确做法是用 `ctx.effect(() => { …; return () => tag.remove(); })` 保证卸载/HMR 时被移除（`ui-theme` 的 `installThemeStyles` 就是这么写的）。

---

## 5. 文件证据汇编

| # | 结论 | 来源 | 原始片段 |
|---|---|---|---|
| 1 | 主色板前缀是 `--dsw-*` | `dsh-client-ui-theme/lib/client.js:1052`（design-platform.css 内嵌字符串） | `var design_platform_css_default = "body{--dsw-static-amber-100:#fef5e7;--dsw-static-amber-400:#f7ad31;…";` |
| 2 | 明暗切换 = `body[data-ds-dark-theme]` | 同文件 `:1052` | `body[data-ds-dark-theme]{--dsw-static-amber-100:#fef5e7;…}` |
| 3 | 切换由 presenter 写 DOM | `dsh-client-ui-layout/lib/client.js:443,468-471` | `const DARK_ATTRIBUTE = "data-ds-dark-theme";` / `document.documentElement.style.colorScheme = scheme;` / `if (scheme === "dark") body.setAttribute(DARK_ATTRIBUTE, ""); else body.removeAttribute(DARK_ATTRIBUTE);` |
| 4 | 首屏 boot 脚本 | `dsh-client-ui-theme/lib/index.js:45-47` | `document.documentElement.style.colorScheme = dark ? 'dark' : 'light'` / `document.body.toggleAttribute('data-ds-dark-theme', dark)` / `document.body.style.setProperty('--dsh-content-font-size', …)` |
| 5 | 无 `data-theme` | 全树 grep `data-theme` | 0 命中 |
| 6 | 字号轴默认 14，范围 12–17 | `dsh-client-ui-theme/lib/client.js:19-23` | `const FONT_SIZE_MIN = 12; const FONT_SIZE_MAX = 17; const DEFAULT_FONT_SIZE = 14;` |
| 7 | 偏好存 `ui-theme` namespace | `dsh-client-ui-theme/lib/index.js:11,17,25-28` | `const THEME_SETTINGS_NAMESPACE = "ui-theme";` / `const DEFAULT_PREFERENCE = "system";` / `z.object({preference: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE), fontSize: z.number().step(1).min(12).max(17).default(14)})` |
| 8 | 落盘 `<harness home>/settings.yaml` | `dsh-settings-file/lib/index.js:32` | `const filename = resolve(config.path ?? join(resolveDshHome(config.dshHome), "settings.yaml"));` |
| 9 | `ctx.theme` API | `dsh-client-ui-theme/lib/types/client/index.d.ts:109-188` | `export declare class ThemeRuntime { getTheme(): ThemeSnapshot; exportInspectTokens(): ThemeTokenInspection[]; setTheme(id: string): void; setFontSize(px: number): void; register(definition: ThemeDefinition): () => void; overrideTokens(source: string, tokens: ThemeTokenOverrides): () => void; }` |
| 10 | 6 张样式表运行时注入 | `dsh-client-ui-theme/lib/client.js:1066-1089` | `const STYLES = [["base.css", base_css_default], …];` / `tag.dataset.pluginCss = \`${PLUGIN_ID}/${name}\`;` |
| 11 | 滚动条契约 | 同文件 `:1056` | `var scrollbar_css_default = "body{--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l1);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l1);--dsh-scrollbar-width:8px}@supports not selector(::-webkit-scrollbar){…}";` |
| 12 | 圆角变量只用 corner-shape | 同文件 `:1050` | `var corner_shape_css_default = "@supports (corner-shape:superellipse(1.5)){:root{--dsw-corner-shape:superellipse(1.5)}*,:before,:after{corner-shape:var(--dsw-corner-shape)}}";` |
| 13 | 三列网格骨架 + 属性标记 | `dsh-client-ui-layout/lib/client.js:277-320` | `jsxs("div", { ref: frameRef, className: AppFrame_module_css_default.frame, style: { gridTemplateColumns: \`${cols.sidebar}px minmax(0, 1fr) ${cols.rightbar}px\` }, "data-sidebar-collapsed": sidebarCollapsed \|\| void 0, "data-rightbar-collapsed": …, "data-rightbar-fullscreen": …, "data-rightbar-instant": …, "data-dragging": …, … })` |
| 14 | 列宽常量 | `dsh-client-ui-layout/lib/types/client/columns.d.ts:13-31` | `export declare const CENTER_MIN = 400; export declare const SIDEBAR_MIN = 264; export declare const SIDEBAR_MAX = 420; export declare const SIDEBAR_DEFAULT = 280; export declare const SIDEBAR_COLLAPSED = 56; export declare const SIDEBAR_AUTO_COLLAPSE = 1024; export declare const RIGHTBAR_MIN = 300; export declare const RIGHTBAR_MAX_RATIO = 0.7; export declare const RIGHTBAR_DEFAULT_RATIO = 0.45;` |
| 15 | `#root` 就是 React 容器 | `dsh-web-frontend/dist/assets/index-DuF6ti6g.js` 末尾 + `dsh-client-ui-renderer/lib/client.js` | `const Cu=document.getElementById("root");if(Cu===null)throw new Error("web app: missing #root");new Iy(Cu).run();` / `const boot = container.querySelector(":scope > [data-dsh-boot]"); if (boot !== null) return hydrateRoot(container, …)` |
| 16 | boot 页 DOM 由 JS 直接构造 | `index-DuF6ti6g.js`（`var by=class{…}`） | `this.root=s1(i1.boot),this.root.dataset.dshBoot="",this.card=s1(i1.card),this.wordmark=s1(i1.wordmark,"HARNESS"),this.spinner=s1(i1.spinner),this.spinner.dataset.dshBootSpinner="",this.hint=s1(i1.hint,"Loading plugins…"),this.card.append(this.wordmark,this.spinner,this.hint),this.root.append(this.card),t.append(this.root)` |
| 17 | boot spinner 进度变量 | 同上 | `this.spinner.style.setProperty("--dsh-boot-arc",\`${String(Math.round(72+t*216))}deg\`)` |
| 18 | 槽位包装 div = `display:contents` | `dsh-client-ui-renderer/lib/client.js`（`SlotOutlet`） | `const ANCHOR_STYLE = { display: "contents" };` / `jsx("div", { "data-slot": slotKey, style: ANCHOR_STYLE, children: renderOutletContent(...) })` |
| 19 | Toast portal + `--dsh-toast-hold` | `index-DuF6ti6g.js` | `T1.createPortal(a.jsxs("div",{className:Yl.toast,role:"alert",style:{...u===null?{}:{left:u},"--dsh-toast-hold":\`${String(s)}ms\`},children:[…]}),document.body)` |
| 20 | Modal portal + role | 同上 | `T1.createPortal(a.jsxs("div",{className:Ut.root,role:"presentation",children:[a.jsx("div",{className:Ut.mask,"aria-hidden":"true",onClick:r}),a.jsx("div",{className:Ce(Ut.dialog,p),role:"dialog","aria-modal":"true","aria-label":i,…})]}),…,document.body)` |
| 21 | Menu DOM 与 role | 同上 | `a.jsxs("button",{type:"button",role:"menuitem",className:Ce(Pe.item,de&&(_==="fill"?Pe.selectedFill:Pe.selected),W.danger===!0&&Pe.danger),…children:[…a.jsx("span",{className:Pe.itemIcon,…}),a.jsx("span",{className:Pe.itemLabel,…}),de&&_==="check"&&a.jsx(Ro,{className:Pe.check})]})` |
| 22 | Button 基元类映射 | 同上 | `function w2({variant:t="ghost",size:r="md",icon:i,className:s,children:c,...u}){return a.jsxs("button",{type:"button",className:Ce(io.button,io[t],io[r],s),...u,children:[i!=null&&a.jsx("span",{className:io.icon,children:i}),c]})}` |
| 23 | Switch / Input / Tag / Pill | 同上 | `a.jsx("button",{type:"button",role:"switch","aria-checked":t,"aria-label":i,…,className:Ce(xc.switch,u),onClick:()=>{r(!t)},children:a.jsx("span",{className:xc.thumb})})` / `a.jsxs("span",{className:Ce(Ql.wrap,r),children:[t!=null&&a.jsx("span",{className:Ql.icon,children:t}),a.jsx("input",{className:Ql.input,...i})]})` / `a.jsx("span",{className:Ce(d7.tag,r),"data-tone":t,children:i})` |
| 24 | StateDot 双形态 | 同上 | `a.jsx("span",{className:Ce(Gl.dot,i),"data-state":t,style:{width:r,height:r},"aria-hidden":"true"})`（另有 `Gl.matrix` 带 `data-state="ongoing"`） |
| 25 | Tooltip DOM | 同上 | `a.jsx("span",{ref:k,className:Vf.bubble,"data-side":x,style:{left:g.x,top:b,…},role:"tooltip",children:_})` |
| 26 | 工具视图 `data-*` 宿主 | 同上 | `a.jsxs("div",{className:Ce(ot.block,m),"data-terminal":"","data-running":h?"":void 0,…})` / `a.jsxs("div",{ref:p,className:Ce(Et.block,h),"data-read":"",…})` / `a.jsxs("div",{className:Ce(Ht.block,s),"data-diff":"",…})` / `a.jsxs("div",{className:Ce(gt.block,c),"data-search":t.kind,…})` / `a.jsxs("div",{className:Ce(nt.block,c),"data-web":"search",…})` |
| 27 | `--dsl-*` 与宿主对应 | `index-DPX2bQLO.css` | `._block_1gdtu_1{--dsl-terminal-radius: 12px;…}` / `._block_onbk6_1{--dsl-read-radius: 12px;--dsl-read-line-height: 22px;--dsl-read-gutter: 48px}` / `._block_12o37_1{--dsl-diff-radius: 12px;--dsl-diff-line-height: 22px}` / `._block_1h7p4_1{--dsl-search-radius: 12px;--dsl-search-line-height: 22px}` / `._block_19q7d_1{--dsl-web-radius: 12px}` / `._block_rsn9u_4{--dsl-code-block-background: var(--dsw-alias-markdown-code-block);…}` |
| 28 | 工具行根属性 | `dsh-client-ui-tool/lib/client.js:1254-1258` | `className: ToolRow_module_css_default.root, "data-variant": variant, "data-tool": toolName, "data-state": state,` |
| 29 | 工具名 CSS 钩子 | `dsh-client-ui-tool/lib/client.js`（ToolRow.module.css） | `.o3BgMG_root[data-tool^=cordis_] .o3BgMG_title{color:var(--dsw-alias-state-business-primary)}` |
| 30 | 工具状态/变体取值 | `dsh-client-ui-tool/lib/types/client/tool/models/tool-call-model.d.ts:12-14` | `export type ToolRowVariant = 'search' \| 'read' \| 'bash' \| 'write' \| 'edit' \| 'code' \| 'others';` / `export type ToolRowState = 'running' \| 'ok' \| 'error' \| 'stopped';` |
| 31 | 侧栏根几何 | `dsh-client-ui-sidebar/lib/client.js`（SidebarRoot.module.css） | `.hHd-Xa_root{--dsh-sidebar-inline-padding:12px;height:100%;padding:6px var(--dsh-sidebar-inline-padding);…background:var(--dsw-specific-sidebar-fill);…}` |
| 32 | composer 真实归属 | `dsh-client-ui-conversation/lib/client.js:15757` | `//#region \0dsh-css:…/ui-conversation/src/client/skeleton/InputBar.module.css.mjs` → `const css$1 = ".uV2eYG_root{…}"` |
| 33 | ui-chat 无 composer | `dsh-client-ui-chat/lib/client.js` | `renderSlot` 名中无任何 composer/input；18 个 CSS module 里无 composer；仅有 `scrollport.querySelector("[data-composer-seat]")` 这类探测 |
| 34 | ui-settings 无 CSS/DOM | `dsh-client-ui-settings/lib/client.js` | region 列表只有 cosmokit/schemastery/schema/settings-scope/settings-mirror/index，**无 `\0dsh-css:`** |
| 35 | `--dsh-content-font-size` 参与字号阶梯 | theme `gradient-shadow-text.css` | `--dsh-content-font-delta:calc(var(--dsh-content-font-size,14px) - 14px)` |
| 36 | `#root` 之外无 UI 容器 | `dsh-web-frontend/dist/index.html:15` | `<div id="root"></div>` |
| 37 | vendor CSS 只有 KaTeX | `vendor-BNsW4eBh.css`（141 个类名全部 `.katex*`/数学排版类） | 无布局类名 |
| 38 | 全局 markdown 类 | `index-DPX2bQLO.css` | `._tableScroll_kcgor_190.md-table-wide{…}` / `._numbered_rsn9u_107 :where(pre) code>.line{…}` |
| 39 | 设置面板几何 | `dsh-client-ui-settings-general/lib/client.js:28` | `.VOzbGW_panel{z-index:1;background:var(--dsw-alias-bg-layer-2);width:800px;max-width:calc(100vw - 48px);height:min(800px,100vh - 48px);box-shadow:var(--dsw-elevation-prominent);border-radius:32px;…}` |
| 40 | 右栏面板几何与状态属性 | `dsh-client-ui-sidebar-right/lib/client.js:608,854-857` | `.P3OORG_panel[data-sidebar-right-open]{visibility:visible;transform:none}` / `"data-sidebar-right-panel": fullscreen ? "fullscreen" : "push", "data-sidebar-right-open": expanded \|\| void 0` |

---

## 6. 未找到 / 无法验证（明确列出，避免误用）

1. **`@deepseek-ai/dsh-client-ui-primitives` 目录不存在**（`Get-Item` 报 `Cannot find path`）。它的源码与 CSS 都在 shell bundle 内，只可从 dist CSS + shell JS 反推。
2. **`@deepseek-ai/dsh-client-ui-dockkit` 目录不存在**。因此**右栏的 tab 条 / 分屏 / 浮动层内部 DOM 不可读**，只能引用 dist CSS 的 `17p4l` 组类名。
3. **`@deepseek-ai/dsh-client-ui-slots`、`dsh-client-store` 目录也不存在**（同属 shell bundle）。
4. **`dsh-client-ui-settings` 无 CSS / 无 DOM / 无 React / 无槽位注册**。它只在 `lib/types/client/contract/slots.d.ts` 里**声明**设置槽位的类型。
5. **没有 `--dsw-radius-*` / `--dsw-space-*` / `--dsw-gap-*` / `--dsw-padding-*` / `--dsw-z-*` 这类刻度变量。** 间距、圆角、z-index 全部是组件内字面量。任务里要求的「间距/圆角分组清单」在本产物中**不存在对应变量族**。
6. **没有 `data-theme` 属性**（0 命中）。
7. **跨构建的类名 hash 稳定性无法验证**（只有一个产物）。
8. **`--dsw-alias-*` 的 90 个里，有 16 个在本树中从未被 `var()` 引用**（如 `--dsw-alias-bg-mask-2/3/photo`、`--dsw-alias-toast-bg`、`--dsw-alias-brand-text`、`--dsw-alias-button-ghost-active-hover`、`--dsw-alias-markdown-placeholder` 等）—— 它们可能是给未发布的消费者准备的。
9. **10 个变量被消费但从未声明**（fallback 永远生效）。这不代表它们「不该存在」——**你在 `:root`/`body` 里定义它们就能生效**，这是一个可用的隐藏扩展点：
   `--dsw-alias-bg-layer-4`、`--dsw-alias-fill-l2`、`--dsw-alias-fill-tertiary`（fallback `#00000014`）、`--dsw-alias-fill-tsp-secondary`、`--dsw-alias-label-error`、`--dsw-alias-label-quaternary`、`--dsw-alias-separator-primary`、`--dsw-font`、`--dsw-font-mono`、`--dsw-font-sm-13`。
10. `--dsh-conversation-column-width`、`--dsh-chat-user-width`、`--dsh-width-handle-pointer-y`、`--dsh-file-type-icon-color`、`--dsh-font-mono` **在本树中没有找到声明处**（只有读取）。
11. `vendor-BNsW4eBh.css` 与布局无关（纯 KaTeX）。
12. `index-DPX2bQLO.css` **没有 `:root` 规则**（0 命中）；`:root` 只出现在 theme 运行时注入的 `base.css` / `corner-shape.css` / `shiki.css` 里。

---

## 7. 附：可直接落地的自定义 CSS 骨架

把下面这段放进你自己的样式表即可覆盖整套主题变量（覆盖 `body` 而不是 `:root`，因为声明在 `body` 上，权重更高）：

```css
/* ============ 1. 基础字体与动效（声明在 :root，直接覆盖即可） ============ */
:root{
  --dsw-font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI",
                     "PingFang SC", "Microsoft YaHei", sans-serif;
  --ds-font-family-code: "JetBrains Mono", "SF Mono", Consolas, monospace;
  --ds-ease-in-out: cubic-bezier(.4, 0, .2, 1);
  --ds-transition-duration: .2s;
  --ds-transition-duration-fast: .1s;
  --ds-transition-duration-slow: .3s;
}

/* ============ 2. 光照层：直接改 aliases 即可全局换肤 ============ */
body{
  /* 背景层级 */
  --dsw-alias-bg-base: #ffffff;
  --dsw-alias-bg-layer-1: #ffffff;
  --dsw-alias-bg-layer-2: #ffffff;
  --dsw-alias-bg-layer-3: #ffffff;
  --dsw-specific-sidebar-fill: #f9fafb;   /* 左栏整列背景 */
  --dsw-specific-input-major: #ffffff;    /* composer 卡片背景 */
  --dsw-specific-selector: #f5f6f7;       /* composer 圆形按钮背景 */
  --dsw-specific-menu: #ffffff;           /* 菜单背景 */
  --dsw-specific-bubble: #edf3fe;         /* 用户气泡 */
  /* 文字 */
  --dsw-alias-label-primary: #0f1115;
  --dsw-alias-label-secondary: #61666b;
  --dsw-alias-label-tertiary: #81858c;
  --dsw-alias-label-caption: #adb2b8;
  /* 描边（border-l1 最淡 → l4 最重） */
  --dsw-alias-border-l1: #0000000a;
  --dsw-alias-border-l2: #0000001a;
  --dsw-alias-border-l3: #0000001f;
  --dsw-alias-border-l4: #00000029;
  /* 交互 */
  --dsw-alias-interactive-bg-hover: #2631480f;
  --dsw-alias-interactive-bg-active: #2631481a;
  --dsw-alias-interactive-bg-hover-solid: #f1f3f5;
  /* 品牌与状态 */
  --dsw-alias-brand-primary: #0f1115;
  --dsw-alias-button-info-fill: #4176e6;  /* 发送按钮 */
  --dsw-alias-link: #4176e6;
  --dsw-alias-state-business-primary: #4176e6;
  --dsw-alias-state-error-primary: #ec1313;
  --dsw-alias-state-warn-primary: #f59e0b;
  --dsw-alias-state-success-primary: #22c55e;
  /* 滚动条（注意：很多容器会局部重绑到 -l2） */
  --dsh-scrollbar-thumb: rgba(0,0,0,.12);
  --dsh-scrollbar-thumb-hover: rgba(0,0,0,.24);
}

/* ============ 3. 暗色：必须用 body[data-ds-dark-theme] ============ */
body[data-ds-dark-theme]{
  --dsw-alias-bg-base: #0f1115;
  --dsw-alias-bg-layer-1: #232324;
  --dsw-alias-bg-layer-2: #2c2c2e;
  --dsw-alias-bg-layer-3: #353638;
  --dsw-specific-sidebar-fill: #1b1b1c;
  --dsw-specific-input-major: #2c2c2e;
  --dsw-specific-selector: #353638;
  --dsw-specific-menu: #353638;
  --dsw-specific-bubble: #2c2c2e;
  --dsw-alias-label-primary: #f9fafb;
  --dsw-alias-label-secondary: #cfd3d6;
  --dsw-alias-label-tertiary: #adb2b8;
  --dsw-alias-label-caption: #81858c;
  --dsw-alias-border-l1: #ffffff0f;
  --dsw-alias-border-l2: #ffffff1f;
  --dsw-alias-border-l3: #ffffff29;
  --dsw-alias-border-l4: #fff3;
  --dsw-alias-interactive-bg-hover: #ffffff14;
  --dsw-alias-interactive-bg-active: #ffffff24;
  --dsw-alias-interactive-bg-hover-solid: #353638;
  --dsw-alias-brand-primary: #f9fafb;
  --dsw-alias-button-info-fill: #679efe;
  --dsw-alias-link: #679efe;
  --dsw-alias-state-business-primary: #679efe;
  --dsw-alias-state-error-primary: #f25a5a;
  --dsw-alias-state-warn-primary: #f59e0b;
  --dsw-alias-state-success-primary: #22c55e;
  --dsh-scrollbar-thumb: rgba(255,255,255,.16);
  --dsh-scrollbar-thumb-hover: rgba(255,255,255,.28);
}

/* ============ 4. 阴影/高度 ============ */
body{
  --dsw-shadow-lv1: 0 2px 4px 0 #0000000d;
  --dsw-shadow-lv2: 0 4px 12px 0 #00000005, 0 2px 8px 0 #0000000a;
  --dsw-shadow-lv3: 0 0 1px 0 #0003, 0 0 4px 0 #00000005, 0 12px 32px 0 #00000014;
  --dsw-mask-blur: blur(2px);
}
/* elevation-* 在 body,body * 上声明；要改就得同样用通用选择器，否则会被逐元素重声明盖掉 */
body, body *{
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l4);
  --dsw-elevation-panel:     0 0 0 .5px var(--dsw-elevation-stroke-color), 0 3px 8px 0 #00000008, 0 0 16px 0 #00000005;
  --dsw-elevation-prominent: 0 0 0 .5px var(--dsw-elevation-stroke-color), 0 3px 8px 0 #0000000a, 0 0 20px 0 #0000000d;
  --dsw-elevation-soft:      0 0 0 .5px var(--dsw-elevation-stroke-color), 0 4px 16px 0 #00000008, 0 0 24px 0 #00000008;
}

/* ============ 5. 字号轴（只影响会话内容，12–17px） ============ */
body{ --dsh-content-font-size: 15px; }

/* ============ 6. 工具视图圆角/行高 ============ */
/* --dsl-* 声明在带 data-* 的块上，必须用同样的宿主选择器覆盖，见下方示例 */
```

**注意 `--dsl-*` 的覆盖方式**：它们声明在带 `data-*` 的块上，所以你要用同样的宿主选择器：

```css
/* 代码块（markdown fenced code） */
pre { --dsl-code-block-border-radius: 10px; }
/* diff / read / search / terminal / web 工具视图 */
[data-diff]{ --dsl-diff-radius: 10px; --dsl-diff-line-height: 22px; }
[data-read]{ --dsl-read-radius: 10px; --dsl-read-gutter: 48px; }
[data-search]{ --dsl-search-radius: 10px; }
[data-terminal]{ --dsl-terminal-radius: 10px; --dsl-terminal-gutter: 30px; }
[data-web]{ --dsl-web-radius: 10px; }
```

**结构性微调（用 data-slot，跨构建最稳）：**

```css
/* 帧级浮层：默认可点击穿透，条目自行恢复 pointer-events */
[data-shell-overlay]{ pointer-events: none; }
[data-shell-overlay] > *{ pointer-events: auto; }

/* 会话内容列宽 */
.EvIC1a_column{ max-width: 860px; }          /* 或覆盖 var(--dsh-chat-content-width) */

/* 设置面板尺寸 */
.VOzbGW_panel{ width: 900px; height: min(760px, 100vh - 48px); }

/* 侧栏宽度由 JS 内联 style 写死在 .hHd-Xa_root 上，只能靠 !important 或在 --dsh-sidebar-* 层调 */
.hHd-Xa_root{ padding: 6px 12px; }
```

**README 里给出的两条硬约束（写覆盖样式时请尊重）：**

> - Third-party themes are an extension point, not a product — registering one means overriding same-named alias variables; **no validation exists that an override set is complete**.
> - The token sheets are the sole color authority — values absent from the design system are deliberately not appended; the nearest semantic token wins.

（`dsh-client-ui-theme/README.md:101-102`）

---

## 8. 复核方式（别人如何独立验证本报告）

所有结论都可用这几条命令复现（只读）：

```powershell
$base = "C:\Users\w-king\AppData\Local\npm-cache\_npx\1e7f6d9597241db0\node_modules\@deepseek-ai"

# 1) 列出某个包内嵌的全部 CSS module 源路径（就是它的样式表清单）
Select-String -Path "$base\dsh-client-ui-conversation\lib\client.js" -Pattern '\\0dsh-css:' |
  ForEach-Object { $_.Line.Trim() }

# 2) 抓出某个包的全部 class map（可读名 -> 产出类名）
$c = Get-Content "$base\dsh-client-ui-sidebar\lib\client.js" -Raw
[regex]::Matches($c,'(?s)var (\w+_module_css_default) = \{(.*?)\};') | ForEach-Object { $_.Value }

# 3) 反解主题 6 张样式表（design-platform.css 是 15.6KB 单行；把 ';' 换成换行才可读）
$t = Get-Content "$base\dsh-client-ui-theme\lib\client.js" -Raw
$s = [regex]::Match($t,'(?s)var design_platform_css_default = "(.*?)";\r?\n').Groups[1].Value -replace '\\"','"'
$s -replace ';',";`n  " -replace '\}','}'

# 4) 提取 dist CSS 的模块分组（hash 段即源文件身份）
$d = Get-Content "$base\dsh-web-frontend\dist\assets\index-DPX2bQLO.css" -Raw
[regex]::Matches($d,'\._([A-Za-z0-9-]+)_([A-Za-z0-9]{5})_([0-9]+)') | ForEach-Object { $_.Value } | Sort-Object -Unique

# 5) 确认没有 data-theme（应为 0 命中）
Get-ChildItem $base -Recurse -File -Include *.js,*.css | Select-String 'data-theme' -List
```

**陷阱提醒（我自己踩过的）：**

- PowerShell 函数里 `return $hashtable` 会被**展开**成条目数组，`.ContainsKey()` 会报 "does not contain a method named"。要么内联写，要么用 `return ,$h`（仍然不可靠）。本报告的所有对照表都是用**按下标配对**或**内联哈希表**的方式算出来的，没有走函数返回。
- 抓 JS 字符串字面量必须用转义感知的正则 `"(?:[^"\\]|\\.)*"`；朴素的 `"(.*?)";` 会在第一个 `\"` 处截断（例如 CSS 里的 `content:""`）。
- 压缩文件是**单行几十万字符**，任何 `Select-String` 输出都要 `Substring` 截断，否则刷屏。
- `.org` / `.w3` / `.com` 这类「类名」是从 `url("data:image/svg+xml,…http://www.w3.org/2000/svg…")` 里正则误抓的；`[data-slot="settings.general.item"]` 里的 `.general` / `.item` 也是假阳性。报告里已剔除。

