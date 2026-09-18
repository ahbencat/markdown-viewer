# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Windows port (Tauri 2) of the macOS Markdown Preview app (`../markdown-preview`, read-only reference — never modify it). MVP scope: open `.md` → render preview → export PDF. Parsing is frontend markdown-it; the Rust backend is a minimal shell.

## Commands

```sh
npm run dev      # Vite dev server; file open falls back to <input type=file> outside Tauri
npm test         # vitest (renderer unit + snapshot tests)
npx vitest run tests/renderer.test.ts   # single test file
UPDATE_SNAPSHOTS=1 npm test             # regenerate tests/__snapshots__ after intentional render changes
npx tsc --noEmit # typecheck (must be clean)
npm run build    # frontend-only build (NOT tauri build)
```

Windows packaging (Windows machine or CI only, never on Linux):
```sh
winget install Rustlang.Rustup
cargo install tauri-cli
cargo tauri build   # msi + nsis installer land in src-tauri/target/release/bundle/
```

## Architecture

- `src/renderer/` — pure-TS render pipeline, mirrors `MarkdownHTML.render` in the macOS repo. Order: frontmatter → footnotes → math extraction → markdown-it → mermaid post-process → math restore → footnote refs/defs → heading IDs → task lists → `==highlight==` → RTL → frontmatter card. **No React imports here** — keeps modules unit-testable in node.
- `src/platform/vendor.ts` — lazy loader for `public/vendor` bundles (KaTeX, Mermaid, highlight.js, DOMPurify). Text paints first, heavy scripts inject after. `App.tsx` sanitizes via DOMPurify *before* innerHTML, then enhances in `requestIdleCallback`.
- `src/platform/tauri.ts` — file open (Tauri dialog+fs plugins, `<input type=file>` fallback outside Tauri). `src/platform/print.ts` — PDF via `window.print()` after `renderAllMermaid("default")`.
- `src/App.tsx` — thin shell: toolbar (Open / Export PDF) + preview pane + sample picker.
- `src/document.css` — extracted from macOS `MarkdownHTML+Stylesheet.swift`; Apple semantic colors mapped to fixed light/dark values, fonts to Segoe UI/Consolas.
- `public/vendor/` — offline JS/CSS copied from the macOS repo (keep the LICENSE files). **Never bundle or CDN these**; they load via script tags from `public/vendor`.
- `src-tauri/` — template minimum (dialog+fs plugins, `.md` file associations). Not compiled on Linux.
- `tests/*.md` double as fixtures (copies of `public/samples/`); `tests/snapshots.test.ts` locks all 9 renders.

## Gotchas

- `vite.config.ts` and `vitest.config.ts` are deliberately split: vitest 3 bundles its own vite copy whose `Plugin` types conflict with `@vitejs/plugin-react`. Do not merge them.
- `markdown-it-footnote` needs the `as unknown as (md: unknown) => void` cast at `.use()` — the `@types/markdown-it` (lib) vs plugin (dist) `Plugin` types disagree; runtime shape is `(md) => void`.
- `esbuild` is pinned to `0.28.2` — newer native binaries segfault on this machine.
- markdown-it options must stay `html:false, linkify:true, typographer:false` (matches macOS: source HTML escaped, bare URLs autolinked). Math/footnote handling is custom (extract-then-restore with `MdPreview…Token` placeholders) — do not swap in `markdown-it-katex` or `markdown-it-footnote`'s default rendering; delimiter rules differ from the macOS original.
- Out of MVP scope: edit mode, search, outline sidebar, themes, autosave, auto-update, HTML/PNG export, i18n. See README.md.
