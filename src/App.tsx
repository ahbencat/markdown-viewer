import { useCallback, useEffect, useRef, useState } from "react";
import { renderMarkdown } from "./renderer";
import { detectLanguage, highlightLanguage, parseCodeFenceInfo } from "./renderer/highlight";
import {
  MARKDOWN_EXTENSIONS,
  classifyImageSrc,
  getLaunchFile,
  isMarkdownPath,
  isTauri,
  onNativeDrop,
  openMarkdownFile,
  readDroppedFile,
  readPathFile,
  resolveLocalImageSrc,
} from "./platform/tauri";
import {
  ensureHighlight,
  ensureKatex,
  ensureMermaid,
  ensurePurify,
  highlightCode,
  observeMermaidFigures,
  renderMath,
} from "./platform/vendor";
import { exportPdf } from "./platform/print";
import type { OpenedDocument } from "./types";

const SAMPLE_FILES = [
  "full.md",
  "mermaid-heavy.md",
  "codeblocks.md",
  "rendering-layout.md",
  "rtl-test.md",
  "long-footnotes.md",
  "toml-frontmatter.md",
  "bullet-marker-spacing.md",
  "navigation.md",
];

const UNSUPPORTED_FILE_MESSAGE = `Only Markdown files (${MARKDOWN_EXTENSIONS.map(
  (ext) => `.${ext}`,
).join(", ")}) can be previewed.`;

export function App() {
  const [doc, setDoc] = useState<OpenedDocument | null>(null);
  const [rendered, setRendered] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const articleRef = useRef<HTMLElement>(null);

  const renderDoc = useCallback(async (markdown: string) => {
    setRendering(true);
    setError(null);
    try {
      // DOMPurify first: nothing reaches innerHTML unsanitized.
      await ensurePurify();
      const purify = window.DOMPurify;
      const result = await renderMarkdown(markdown, {
        assetBaseHref: undefined,
        purify: purify
          ? { sanitize: (dirty, config) => purify.sanitize(dirty, config) }
          : undefined,
      });
      setRendered(result.articleHTML);

      // Heavy vendors load lazily, text first — then enhance.
      const jobs: Promise<unknown>[] = [];
      if (result.containsMath) {
        jobs.push(
          ensureKatex()
            .then(() => renderMath())
            .catch((err: unknown) => {
              throw new Error(
                `KaTeX failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }),
        );
      }
      if (result.containsMermaid) {
        jobs.push(
          ensureMermaid()
            .then(() => observeMermaidFigures())
            .catch((err: unknown) => {
              throw new Error(
                `Mermaid failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }),
        );
      }
      if (result.containsCode) {
        jobs.push(
          ensureHighlight()
            .then(() =>
              highlightCode((code, className) => {
                const m = /language-([\w+-]+)/.exec(className);
                if (m) return highlightLanguage(m[1].toLowerCase());
                return detectLanguage(code);
              }),
            )
            .catch(() => {
              // Highlight failure is cosmetic — never fail the render.
            }),
        );
      }
      const settled = await Promise.allSettled(jobs);
      const failed = settled.find((s) => s.status === "rejected") as
        | PromiseRejectedResult
        | undefined;
      if (failed) setError(String(failed.reason));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(false);
    }
  }, []);

  const handleOpen = useCallback(async () => {
    const opened = await openMarkdownFile();
    if (!opened) return;
    setDoc(opened);
    void renderDoc(opened.markdown);
  }, [renderDoc]);

  const handleSample = useCallback(
    async (name: string) => {
      try {
        const res = await fetch(`samples/${name}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const markdown = await res.text();
        setDoc({ path: `samples/${name}`, markdown });
        void renderDoc(markdown);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [renderDoc],
  );

  const handleExportPdf = useCallback(() => {
    void exportPdf();
  }, []);

  // Native OS file drop in Tauri (paths from the OS), HTML5 fallback
  // in a plain browser. Tauri consumes the OS drop itself on Windows,
  // so the HTML5 listeners stay browser-only to avoid double handling.
  useEffect(() => {
    if (isTauri()) {
      void getLaunchFile()
        .then((path) => {
          if (!path || !isMarkdownPath(path)) return;
          return readPathFile(path).then((opened) => {
            setDoc(opened);
            void renderDoc(opened.markdown);
          });
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
        });

      let unlisten: (() => void) | undefined;
      let cancelled = false;
      void onNativeDrop((event) => {
        switch (event.type) {
          case "enter":
            if (event.paths.some((p) => isMarkdownPath(p))) {
              setDragging(true);
            }
            break;
          case "leave":
            setDragging(false);
            break;
          case "drop": {
            setDragging(false);
            const target = event.paths.find((p) => isMarkdownPath(p));
            if (!target) {
              setError(UNSUPPORTED_FILE_MESSAGE);
              return;
            }
            void readPathFile(target)
              .then((opened) => {
                setDoc(opened);
                void renderDoc(opened.markdown);
              })
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : String(err));
              });
            break;
          }
          case "over":
            break;
        }
      }).then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      });
      return () => {
        cancelled = true;
        unlisten?.();
      };
    }
    const onDrop = (ev: DragEvent) => {
      ev.preventDefault();
      const file = ev.dataTransfer?.files?.[0];
      if (!file) return;
      if (!isMarkdownPath(file.name)) {
        setError(UNSUPPORTED_FILE_MESSAGE);
        return;
      }
      void readDroppedFile(file)
        .then((opened) => {
          setDoc(opened);
          void renderDoc(opened.markdown);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
        });
    };
    const onDragOver = (ev: DragEvent) => ev.preventDefault();
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    return () => {
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDragOver);
    };
  }, [renderDoc]);

  // Inject rendered article HTML (sanitized via DOMPurify in renderDoc).
  // Vendor enhancement runs after paint via requestIdleCallback so the
  // text is visible before KaTeX/Mermaid/highlight parse their bundles.
  useEffect(() => {
    if (articleRef.current) {
      articleRef.current.innerHTML = rendered;
      // Local images (`./img/a.png`, `D:\pics\b.png`) must go through the
      // asset protocol: WebView2 refuses file:// subresources from a
      // tauri:// page, and relative srcs have no base to resolve against.
      if (isTauri() && doc !== null) {
        const docPath = doc.path;
        const imgs = articleRef.current.querySelectorAll("img[src]");
        void Promise.all(
          Array.from(imgs).map(async (img) => {
            const raw = img.getAttribute("src");
            if (raw === null) return;
            const kind = classifyImageSrc(raw);
            if (kind === "remote" || kind === "data") return;
            try {
              img.setAttribute(
                "src",
                await resolveLocalImageSrc(raw, docPath),
              );
            } catch {
              // Leave the broken src in place — the alt text still shows.
            }
          }),
        ).catch(() => {
          // Aggregate failure is non-fatal; per-image errors handled above.
        });
      }
      if (rendered !== "") {
        const enhance = () => {
          renderMath();
          highlightCode((code, className) => {
            const m = /language-([\w+-]+)/.exec(className);
            if (m) {
              const info = parseCodeFenceInfo(m[1]);
              return highlightLanguage(info.language);
            }
            return detectLanguage(code);
          });
          observeMermaidFigures();
        };
        if ("requestIdleCallback" in window) {
          const id = window.requestIdleCallback(enhance, { timeout: 1000 });
          return () => window.cancelIdleCallback(id);
        }
        const t = setTimeout(enhance, 0);
        return () => clearTimeout(t);
      }
    }
    return undefined;
  }, [doc, rendered]);

  const empty = doc === null;

  return (
    <div className="mdp-app">
      <header className="mdp-toolbar">
        <span className="mdp-title" title={doc?.path ?? ""}>
          {doc ? doc.path : "md-view-win"}
        </span>
        <div className="mdp-actions">
          <button type="button" onClick={handleOpen}>
            Open file…
          </button>
          <button type="button" onClick={handleExportPdf} disabled={empty}>
            Export PDF
          </button>
        </div>
      </header>
      {error !== null && <div className="mdp-error">{error}</div>}
      {dragging && (
        <div className="mdp-drop-overlay">
          <span>Drop a Markdown file to preview it</span>
        </div>
      )}
      {empty ? (
        <main className="mdp-empty">
          <p>
            {isTauri()
              ? "Open a Markdown file to preview it."
              : "Open a Markdown file — or pick a sample below (dev fallback, no Tauri backend)."}
          </p>
          {!isTauri() && (
            <ul className="mdp-samples">
              {SAMPLE_FILES.map((name) => (
                <li key={name}>
                  <button type="button" onClick={() => handleSample(name)}>
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mdp-hint">
            Tip: you can also drag &amp; drop a .md file onto this window.
          </p>
        </main>
      ) : (
        <main className="mdp-preview">
          {rendering && <div className="mdp-rendering">Rendering…</div>}
          <article
            ref={articleRef as React.RefObject<HTMLElement>}
            className="markdown-body"
          />
        </main>
      )}
    </div>
  );
}
