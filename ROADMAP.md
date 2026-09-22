# md-view-win Roadmap — v0.2.0

> 规划日期：2026-09-20 · 状态：待实施
>
> v0.1.0 已发布（MVP 闭环：打开 → 渲染 → 导出 PDF），原生文件拖拽已落地（`f32b045`）。
> 本文档规划 0.2.0 的三项功能：**最近文件、页内搜索、大纲侧边栏** —— 都是 README 里明确列为
> MVP 之外、日常阅读长文档时最先撞到的缺口。

## Context

- **没有搜索** —— 长文档只能靠 Ctrl+F 浏览器原生查找，但 Tauri 下 WebView2 的原生查找栏会盖住应用 UI，且无法与渲染后的 KaTeX/Mermaid 一致工作。
- **没有大纲** —— `injectHeadingIDs` 已经给每个标题发了 `id="md-heading-N"`，但这份结构完全没被利用，长文档只能滚动。
- **没有最近文件** —— 每次启动都要重新走文件对话框，重复打开同一份文档代价高。

目标：在不破坏现有渲染管线纯净性（`src/renderer/` 无 React、可在 node 单测）的前提下补齐这三项，
每项独立提交、独立可回归。

---

## 设计原则（沿用仓库既有约定）

1. **纯逻辑与 DOM 接线分离**。`src/renderer/` 保持纯 TS、可 node 单测；DOM/浏览器 API 一律放 `src/platform/`。
   现有 `vitest.config.ts` 是 `environment: "node"`，没有 jsdom —— 因此把可测逻辑抽成不依赖 DOM 的纯函数，
   不引入 jsdom 依赖。
2. **不碰渲染管线顺序**。`src/renderer/index.ts` 的流水线顺序与 macOS 版逐模块对应，三个功能都在「渲染产出之后」工作，
   只在流水线末端读取结果，不插入新阶段。
3. **复用既有能力**，不新增 Rust 插件、不新增运行时依赖。

---

## 功能一：最近文件

**最低风险，先做。无布局改动。**

### 持久化选型

用 `localStorage`，不用 `plugin-store`。

理由：后端刻意保持「minimal Rust shell」（`src-tauri/Cargo.toml` 只有 dialog + fs 两个插件），
为一列路径引入 `plugin-store` 需要新增 Rust 依赖 + capability，代价与收益不成比例。
WebView2 下 origin 固定（`tauri://localhost`），localStorage 持久可靠，且在 `npm run dev` 的浏览器回退下同样可用。

封在 `src/platform/recent.ts` 后面，将来要换 `plugin-store` 只动这一个文件。

### 改动

- **新增 `src/platform/recent.ts`**
  - 纯函数 `mergeRecent(list, entry, cap = 10)`：按 `path` 去重、命中则提到首位、截断到 cap。
    **纯函数便于 node 单测。**
  - `loadRecent()` / `saveRecent()`：读写 localStorage，key 用 `mdp.recent.v1`。
    `loadRecent()` 需 try/catch + `Array.isArray` 校验，localStorage 内容可能被手改或跨版本腐坏。
  - 条目形状 `{ path: string; title: string; openedAt: number }`。
- **`src/App.tsx`**
  - 所有**成功打开真实文件**的入口调用 `rememberRecent(opened)`：`handleOpen`、原生 drop 分支、HTML5 drop 分支。
    `handleSample` **不记**（样例是应用自带资源，不是用户文件）。
  - 空状态 `mdp-empty` 内、样例列表之上，渲染 Recent 区块（可点击列表 + 清空按钮）。
  - 点击条目走**已有的 `readPathFile(path)`**（`src/platform/tauri.ts`）。
    读失败（文件被移动/删除/改名）→ 从列表剔除该条 + 复用现有 `setError` 显示原因。这是本功能的关键体验点。
- **`src/app.css`**：`.mdp-recent` 列表样式，沿用 `.mdp-samples` 的既有观感。

### 待验证（实现前确认）

`fs:allow-read-text-file` 在 `capabilities/default.json` 里**未带 scope**。拖拽测试能通过说明读任意路径放行，
但拖拽是 OS 层投递、与「从对话框选择」的运行时 scope 授予路径不同。实现时先确认「按路径直接重开」不被 scope 拦。

---

## 功能二：页内搜索（Ctrl+F）

### 核心选型：CSS Custom Highlight API，不改 DOM

用 `CSS.highlights` + `Range` 绘制命中，**不插入 `<mark>` 包裹节点**。

理由（针对本项目）：
文章 HTML 经 DOMPurify 清洗后由 `articleRef.current.innerHTML` 注入（`App.tsx`），
随后 KaTeX / Mermaid / highlight.js 在 `requestIdleCallback` 里**异步重写 DOM**（`App.tsx` 的 enhance 回调）。
若用 `<mark>` 改 DOM，会与这些增强器互相踩踏、并在重渲染时残留。
Custom Highlight API 只在渲染层上色，DOM 不动 —— 这正是它存在的意义。
WebView2 是 Chromium，原生支持；`npm run dev` 的 Chrome/Edge 回退同样支持。

`::highlight()` 只支持 `color / background-color / text-decoration / text-shadow`，
在 `src/app.css` 定义两套伪元素规则（`::highlight(mdp-search)` 与 `::highlight(mdp-search-current)`），
分别给明暗主题值，沿用文件里既有的 `prefers-color-scheme` 分叉写法。

### 改动

- **新增 `src/renderer/search.ts`（纯逻辑，无 DOM）**
  - `findMatches(haystack: string, query: string, caseSensitive: boolean): Array<{ start: number; end: number }>`。
    用 `indexOf` 循环实现（不用正则）—— 避免用户输入 `(` `[` `*` 等触发正则语法或体积放大。
  - **纯函数，直接 node 单测**（覆盖空串、重叠串如 `aaa` 查 `aa`、大小写、Unicode）。
- **新增 `src/platform/search.ts`（DOM 接线）**
  - `collectTextNodes(root)`：`TreeWalker` 遍历文本节点，**跳过 `script` / `style`**。
  - `applyHighlights(matches, currentIndex)`：建 `Range` → 塞进 `Highlight` 实例 → `CSS.highlights.set(...)`。
  - `clearHighlights()`：`CSS.highlights.delete(...)`。
  - `scrollToMatch(range, scroller)`：`getBoundingClientRect()` + 容器 `scrollTop` 手动定位。
- **`src/App.tsx`**
  - 全局 `keydown` 监听：`Ctrl+F` / `Cmd+F` → `preventDefault()` 并开搜索栏。
    **必须 preventDefault**，否则 WebView2 自带查找栏会盖上来。
  - `Enter` = 下一个、`Shift+Enter` = 上一个、`Esc` = 关闭并 `clearHighlights()`。
  - 搜索栏 UI 做成工具栏下方的覆盖条，可参考既有 `.mdp-drop-overlay` 的浮层写法。
  - 显示命中计数 `3 / 17`；`query` 为空时不显示计数、清除所有高亮。
  - **在 `rendered` 变化的 effect 里重新执行搜索**，并在 vendor 增强完成后再跑一次
    （KaTeX/Mermaid 会改变文本内容，否则高亮位置会错位）。
  - 关闭文档 / 切换文档时清理 `CSS.highlights`，否则残留高亮会串到下一篇。
- **`src/app.css`**：`.mdp-searchbar` 样式 + 两条 `::highlight()` 规则 + 并入 `@media print` 的隐藏列表。

### 已知取舍（写进注释）

Mermaid SVG 与 KaTeX 的渲染文本会参与匹配（它们是真实文本节点）。行为一致、不特判。
若后续觉得噪音大，再考虑跳过 `svg` 子树 —— MVP 不做。

---

## 功能三：大纲侧边栏

**改动最大（动布局与打印样式），放最后。**

### 数据来源：读渲染后的 DOM，不重新解析 Markdown

`injectHeadingIDs`（`src/renderer/index.ts`）在**脚注渲染之后**运行，所以 DOM 才是标题 id 与正文的最终真相。
直接 `article.querySelectorAll("h1,h2,h3,h4,h5,h6")`，取 `id` + `textContent.trim()`。

### 改动

- **新增 `src/renderer/outline.ts`（纯逻辑，无 DOM）**
  - `buildOutline(entries: Array<{ id: string; level: number; text: string }>): OutlineItem[]`。
    **入参是纯数据**，DOM 查询在调用侧完成 —— 这样能在 node 里单测缩进层级的归一化逻辑
    （文档若从 `h2` 起，应把 `h2` 当基准层，而不是留 1 级空缩进）。
- **`src/App.tsx`**
  - 渲染完成后查询标题，`useMemo` 出大纲。
  - 工具栏加「Outline」切换按钮；折叠状态存 localStorage。
  - 点击条目 → `document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" })`
    （id 已是全局唯一，直接用原生 API，不必自己算偏移）。
  - 滚动联动：`IntersectionObserver` 监听标题，高亮当前章节；或退化为「取最后一个已滚过顶部的标题」，
    后者更稳且无需 observer 生命周期管理 —— 实现时取更简单的那个。
- **布局（`src/app.css`）**
  - 当前 `.mdp-app` 是 `flex-direction: column`。新增 `.mdp-body { display: flex; flex: 1; min-height: 0; }`
    包住大纲 + 预览区，**`min-height: 0` 是关键**，否则内层滚动容器会撑破 flex 高度。
  - 大纲面板自身 `overflow-y: auto`。
- **打印**：把 `.mdp-outline` 加进 `src/app.css` 既有的 `@media print { display: none !important }` 列表
  （该列表目前含 `.mdp-toolbar`、`.mdp-error`、`.mdp-rendering`、`.mermaid-hud`）。
  **导出 PDF 时大纲绝不能出现在纸上。**
- **RTL**：大纲继承文档方向，避免与 `src/renderer/rtl.ts` 的段落推断打架。
- 无标题（大纲为空）时隐藏按钮与面板。

### 待验证（实现前确认）

1. `sanitizeArticle`（`src/renderer/sanitize.ts`）是否保留 `id` 属性 —— DOMPurify 默认允许 `id`，
   但它是在 `injectHeadingIDs` **之后**跑的，需确认清洗没把锚点抹掉。
2. `.mdp-preview` 是否确为滚动容器（从 `@media print` 里覆写 `overflow: visible` 反推为是）。
   这决定滚动联动取哪个 `root`。

---

## 实施顺序与提交划分

按风险递增，每项一个独立提交，各自带测试：

1. `feat: recent files` —— 最小、无布局改动、无新依赖
2. `feat: in-page search (Ctrl+F)` —— 自成一体，不动布局
3. `feat: outline sidebar` —— 动 flex 布局 + 打印样式，风险最高

> **决策记录**：v0.1.0 安装包**不含**拖拽功能（打包时拖拽代码尚未落地），发布说明却提到了
> drag & drop。已决定**不替换 v0.1.0 资产**，拖拽随本次三项一起进 0.2.0。

三项落地后：
- 更新 `README.md` / `README.zh.md` 的「Not yet supported」列表（英文为主、中文同步）
- 版本推进到 `0.2.0`（`package.json` + `src-tauri/tauri.conf.json` + `src-tauri/Cargo.toml`，三者必须一致 ——
  v0.1.0 时 `package.json` 与 `tauri.conf.json` 曾不一致，打包才暴露）

---

## 测试策略

沿用仓库现状：`vitest.config.ts` 是 `environment: "node"`，**不引入 jsdom**。
把可测逻辑全部抽成纯函数，DOM 接线保持薄到无需测试：

| 新增测试 | 覆盖 |
|---|---|
| `tests/search.test.ts` | `findMatches`：空查询、重叠、大小写、Unicode、无命中 |
| `tests/outline.test.ts` | `buildOutline`：层级归一化、跳级、空输入、单标题 |
| `tests/recent.test.ts` | `mergeRecent`：去重提前、cap 截断、腐坏数据 |

现有 `tests/platform.test.ts`、`tests/renderer.test.ts`、`tests/snapshots.test.ts`（36 用例）必须保持全绿。
**渲染管线未改动，快照不应变化** —— 若快照有 diff，说明误碰了流水线，需回查。

---

## 验证方式（每项做完后实测，不只跑测试）

1. `npx tsc --noEmit` 干净 + `npm test` 全绿
2. `npm run dev`（浏览器回退）逐项手测
3. **`cargo tauri dev` 实机验证**（vite 的 `server.watch.ignored` 已修，dev 可正常启动）：
   - 最近文件：打开文件 → 重启应用 → 列表仍在；手动删除该文件后再点 → 条目消失且报错合理
   - 搜索：Ctrl+F 开栏、Enter 循环、Esc 关闭、切换文档后无残留高亮；
     **在 `full.md` / `mermaid-heavy.md` 上验证**，确认高亮不破坏 KaTeX/Mermaid 渲染
   - 大纲：`navigation.md` 做标题密集样本；点条目跳转；滚动联动高亮；
     **点 Export PDF 确认大纲不出现在 PDF 里**

---

## 待确认的未知项（实现时先查，别猜）

1. `fs` 无 scope 时能否按路径重开任意文件（影响功能一）
2. DOMPurify 是否保留 heading `id`（影响功能三）
3. `.mdp-preview` 是否为滚动容器（影响功能三的 scroll spy root）
4. `::highlight()` 内能否用 `var()` 取现有主题色（影响功能二配色写法）

这四项都是只读排查，5 分钟内能出结论。
