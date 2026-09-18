# md-view-win

Windows port (Tauri 2) of the macOS Markdown Preview app. MVP scope: open a
`.md` file → render preview → export PDF. Markdown parsing happens in the
frontend (markdown-it); the Rust backend is a minimal Tauri shell.

## Status

Early MVP scaffolding. `src/renderer/*` are pure-TS ports of the macOS
`MarkdownHTML` pipeline (`frontmatter`, `math`, `mermaid`, `footnotes`,
`highlight`, `rtl`, `katex`, `sanitize`); `public/vendor` holds the offline
JS/CSS bundles copied from the macOS repo (KaTeX 0.16.45, Mermaid 11.14.0,
highlight.js 11.10.0, DOMPurify, morphdom — keep their LICENSE files).

## Develop (Linux, no Rust needed)

```sh
npm install
npm run dev      # Vite dev server; file open falls back to <input type=file>
npm test         # vitest renderer unit tests
npm run build    # frontend-only build (NOT tauri build)
```

Samples from the macOS repo live in `public/samples/` for render comparison.

## Windows packaging (deferred)

Requires Rust + Tauri CLI on a Windows machine or CI (`windows-latest`):

```sh
# Windows only:
winget install Rustlang.Rustup
cargo install tauri-cli
cargo tauri build
```

`src-tauri/` currently holds only the template minimum and is not compiled
on Linux.

## Explicitly out of MVP scope

Edit mode, search, outline sidebar, inspector, custom themes, autosave/file
watch, recent files, Quick Look equivalent, auto-update, HTML/PNG export,
print font-size stepper, i18n (English first), crash reporting, Open-in-LLM.
