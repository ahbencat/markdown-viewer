# md-view-win

[English](README.md) | 中文

Windows 平台的 Markdown 预览应用，基于 [Tauri 2](https://tauri.app/) 构建。它是 macOS 应用 Markdown Preview 的移植版：打开 `.md` 文件 → 渲染预览 → 导出 PDF。

- 上游原始仓库：[pluk-inc/markdown-preview](https://github.com/pluk-inc/markdown-preview)（macOS 原生应用，Swift/AppKit/WKWebView）
- 作者的 fork（对照用）：[ahbencat/markdown-preview](https://github.com/ahbencat/markdown-preview)
- 本仓库为独立重写的新项目，与上游无 fork 关系，详见[致谢](#致谢)

<p>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%2010%2F11-blue" />
  <img alt="Tauri" src="https://img.shields.io/badge/tauri-2.x-teal" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green" />
</p>

## 功能特性

- 打开本地 Markdown 文件（`.md` / `.markdown` / `.mdown` / `.mkd` / `.mkdn` / `.mdx`），支持文件拖拽
- 完整渲染：GFM 表格、任务列表、脚注、YAML/TOML frontmatter 卡片、`==高亮==`
- 数学公式（KaTeX）、流程图（Mermaid，支持缩放）、代码高亮，全部离线可用
- RTL（阿拉伯语 / 希伯来语等）段落方向自适应，明暗主题跟随系统
- 一键导出 PDF（经由系统打印对话框 → 另存为 PDF）

## 安装（最终用户）

在 Windows 机器上构建安装包（需要 Rust 工具链）：

```powershell
winget install Rustlang.Rustup
# 重启终端后：
cargo install tauri-cli
cd md-view-win
cargo tauri build
```

构建产物在 `src-tauri/target/release/bundle/`：用 `msi/` 或 `nsis/` 目录下的**安装包**分发给用户（会自动注册 `.md` 文件关联、开始菜单与卸载项）。`target/release/` 下的裸 `md-view-win.exe` 可直接运行，但不推荐单独分发。

> 说明：用户电脑需要 WebView2 Runtime，Win11 与近年 Win10 均已预装。若未签名，首次安装时 SmartScreen 会提示"未知发布者"，属正常现象。

## 开发

Linux 上可直接开发前端与渲染逻辑，无需 Rust：

```sh
npm install
npm run dev      # Vite 开发服务器；非 Tauri 环境下文件打开自动降级为 <input type=file>
npm test         # vitest：单元测试 + 快照回归
npx tsc --noEmit # 类型检查（提交前保持干净）
npm run build    # 仅构建前端（不是 tauri build）
```

`public/samples/` 下有 9 个从 macOS 版拷来的样例文档，`npm run dev` 后可逐个打开做渲染对照；`UPDATE_SNAPSHOTS=1 npm test` 可在有意改动渲染输出后更新快照。

## 技术栈

| 层 | 选型 |
|---|---|
| 外壳 | Tauri 2（Windows 上为 WebView2） |
| 前端 | React 19 + TypeScript + Vite |
| Markdown 解析 | markdown-it（`html:false`、`linkify:true`、`typographer:false`，与 macOS 版一致） |
| 公式 / 图表 / 高亮 / 清洗 | KaTeX 0.16.45、Mermaid 11.14.0、highlight.js 11.10.0、DOMPurify（`public/vendor` 离线 bundle，懒加载，绝不打进主包） |
| 后端 | 最小 Rust 外壳（文件对话框 + 文件读取插件，无自定义 command） |

渲染管线（`src/renderer/`）逐模块对应 macOS 版 `MarkdownHTML`：frontmatter → 脚注抽取 → 数学公式抽取 → markdown-it → Mermaid 后处理 → 公式恢复 → 脚注渲染 → 标题 ID → 任务列表 → RTL。详见 [CLAUDE.md](CLAUDE.md)。

## 暂不支持（MVP 之外）

编辑模式、页内搜索、大纲侧边栏、主题自定义、自动保存 / 文件监视、最近文件、自动更新、HTML/PNG 导出、多语言界面。

## 支持作者

如果这个应用帮你节省了时间，可以请我喝杯咖啡 ☕

<p align="center">
  <img src="qr-code.png" alt="Buy Me a Coffee 收款码" width="220" />
</p>

## 致谢

- 上游 macOS 版：[pluk-inc/markdown-preview](https://github.com/pluk-inc/markdown-preview)（MIT），渲染管线设计、样式表与 vendor bundle 均源于此
- [KaTeX](https://katex.org/)、[Mermaid](https://mermaid.js.org/)、[highlight.js](https://highlightjs.org/)、[DOMPurify](https://github.com/cure53/DOMPurify)（各自 LICENSE 见 `public/vendor/`）

## 许可证

代码部分采用 MIT 许可证（与上游一致）；`public/vendor/` 下第三方资产保留各自许可证。
