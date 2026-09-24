# md-view-win

**A fast, lightweight Markdown preview app for Windows 10/11, built with [Tauri 2](https://tauri.app/).**

Open any `.md` file → get a clean, faithful preview → export to PDF in one click. No Electron bloat and no network required: math, diagrams, and syntax highlighting all work fully offline.

This is a Windows port of the macOS app [pluk-inc/markdown-preview](https://github.com/pluk-inc/markdown-preview), rebuilt from scratch with React 19 + TypeScript on WebView2. The render pipeline mirrors the macOS original module by module, so the output stays faithful to it.

[中文说明](README.zh.md)

<p>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%2010%2F11-blue" />
  <img alt="Tauri" src="https://img.shields.io/badge/tauri-2.x-teal" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green" />
  <a href="https://buymeacoffee.com/ahben"><img alt="Buy Me a Coffee" src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?&logo=buy-me-a-coffee&logoColor=black" /></a>
</p>

- Upstream original: [pluk-inc/markdown-preview](https://github.com/pluk-inc/markdown-preview) (native macOS app, Swift/AppKit/WKWebView)
- Author's fork (reference only): [ahbencat/markdown-preview](https://github.com/ahbencat/markdown-preview)
- This repo is an independent rewrite, not a fork of upstream — see [Credits](#credits)

## Features

- Open local Markdown files (`.md` / `.markdown` / `.mdown` / `.mkd` / `.mkdn` / `.mdx`), with drag & drop
- Full rendering: GFM tables, task lists, footnotes, YAML/TOML frontmatter cards, `==highlight==`
- Math (KaTeX), diagrams (Mermaid with zoom), code highlighting — all offline
- RTL (Arabic / Hebrew / …) paragraph direction inference, light/dark follows the system
- One-click PDF export (via the system print dialog → Save as PDF)

## Install (end users)

Build the installer on a Windows machine (requires the Rust toolchain):

```powershell
winget install Rustlang.Rustup
# after restarting the terminal:
cargo install tauri-cli
cd md-view-win
cargo tauri build
```

Artifacts land in `src-tauri/target/release/bundle/`: distribute the **installer** from `msi/` or `nsis/` (it registers `.md` file associations, Start menu entries, and uninstall). The bare `md-view-win.exe` under `target/release/` also runs standalone, but is not recommended for distribution.

> Note: user machines need the WebView2 Runtime, preinstalled on Win11 and recent Win10. An unsigned build triggers a SmartScreen "unknown publisher" prompt on first install — expected.

## Develop

Frontend and rendering work on Linux directly, no Rust needed:

```sh
npm install
npm run dev      # Vite dev server; file open falls back to <input type=file> outside Tauri
npm test         # vitest: unit + snapshot regression tests
npx tsc --noEmit # typecheck (keep clean before committing)
npm run build    # frontend-only build (NOT tauri build)
```

`public/samples/` holds 9 sample documents copied from the macOS app — open each in `npm run dev` for render comparison; `UPDATE_SNAPSHOTS=1 npm test` refreshes snapshots after intentional render changes.

## Tech stack

| Layer | Choice |
|---|---|
| Shell | Tauri 2 (WebView2 on Windows) |
| Frontend | React 19 + TypeScript + Vite |
| Markdown parsing | markdown-it (`html:false`, `linkify:true`, `typographer:false`, matching macOS behavior) |
| Math / diagrams / highlighting / sanitizing | KaTeX 0.16.45, Mermaid 11.14.0, highlight.js 11.10.0, DOMPurify (offline bundles in `public/vendor`, lazily loaded, never in the main bundle) |
| Backend | Minimal Rust shell (file-dialog + file-read plugins, no custom commands) |

The render pipeline (`src/renderer/`) mirrors macOS `MarkdownHTML` module by module: frontmatter → footnote extraction → math extraction → markdown-it → Mermaid post-process → math restore → footnote rendering → heading IDs → task lists → RTL. See [CLAUDE.md](CLAUDE.md).

## Not yet supported (beyond MVP)

Edit mode, in-page search, outline sidebar, custom themes, autosave / file watching, recent files, auto-update, HTML/PNG export, localized UI.

## Support

If this app saves you time, you can buy me a coffee ☕

<p align="center">
  <img src="qr-code.png" alt="Buy Me a Coffee QR code" width="220" />
</p>

## Credits

- Upstream macOS app: [pluk-inc/markdown-preview](https://github.com/pluk-inc/markdown-preview) (MIT) — render pipeline design, stylesheet, and vendor bundles originate there
- [KaTeX](https://katex.org/), [Mermaid](https://mermaid.js.org/), [highlight.js](https://highlightjs.org/), [DOMPurify](https://github.com/cure53/DOMPurify) (their licenses live in `public/vendor/`)

## License

Code is MIT licensed (same as upstream); third-party assets under `public/vendor/` keep their own licenses.
