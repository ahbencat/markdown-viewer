import { useCallback, useEffect, useRef, useState } from "react";
import { renderMarkdown } from "./renderer";
import {
  isTauri,
  openMarkdownFile,
  readDroppedFile,
} from "./platform/tauri";
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

export function App() {
  const [doc, setDoc] = useState<OpenedDocument | null>(null);
  const [rendered, setRendered] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const articleRef = useRef<HTMLElement>(null);

  const renderDoc = useCallback(async (markdown: string) => {
    setRendering(true);
    setError(null);
    try {
      const result = await renderMarkdown(markdown, {
        assetBaseHref: undefined,
      });
      setRendered(result.articleHTML);
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

  // HTML5 drag-drop fallback (Tauri drag-drop events hook in later).
  useEffect(() => {
    const onDrop = (ev: DragEvent) => {
      ev.preventDefault();
      const file = ev.dataTransfer?.files?.[0];
      if (!file) return;
      void readDroppedFile(file).then((opened) => {
        setDoc(opened);
        void renderDoc(opened.markdown);
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

  // Inject rendered article HTML (already sanitized by DOMPurify when a
  // purify instance is wired; MVP dev path renders without it).
  useEffect(() => {
    if (articleRef.current) {
      articleRef.current.innerHTML = rendered;
    }
  }, [rendered]);

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
