// Lazy vendor loader: KaTeX / Mermaid / highlight.js / DOMPurify are
// served from public/vendor (never bundled, never CDN) and injected as
// <script>/<link> on demand. Mirrors the VendorLoading.lazy idea from the
// macOS app: document text paints first, heavy bundles parse later.

export interface VendorState {
  purify: boolean;
  katex: boolean;
  katexCss: boolean;
  highlight: boolean;
  mermaid: boolean;
}

const loaded: VendorState = {
  purify: false,
  katex: false,
  katexCss: false,
  highlight: false,
  mermaid: false,
};

declare global {
  interface Window {
    DOMPurify?: {
      sanitize(dirty: string, config?: Record<string, unknown>): string;
    };
    katex?: {
      render(
        tex: string,
        el: Element,
        opts?: Record<string, unknown>,
      ): void;
    };
    hljs?: {
      getLanguage(name: string): unknown;
      highlight(code: string, opts: { language: string }): { value: string };
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mermaid?: any;
    MdPreviewMermaid?: { renderAll: (theme?: string) => Promise<void> };
  }
}

function loadScript(src: string): Promise<void> {
  if (
    document.querySelector(`script[data-mdp-vendor="${src}"]`) !== null
  ) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.defer = true;
    el.dataset.mdpVendor = src;
    el.onload = () => resolve();
    el.onerror = () =>
      reject(new Error(`vendor script failed to load: ${src}`));
    document.head.appendChild(el);
  });
}

function loadStylesheet(href: string): void {
  if (document.querySelector(`link[data-mdp-vendor="${href}"]`) !== null) {
    return;
  }
  const el = document.createElement("link");
  el.rel = "stylesheet";
  el.href = href;
  el.dataset.mdpVendor = href;
  document.head.appendChild(el);
}

/** DOMPurify must load before the first articleHTML hits innerHTML. */
export async function ensurePurify(): Promise<void> {
  if (loaded.purify && window.DOMPurify) return;
  await loadScript("vendor/purify.min.js");
  loaded.purify = true;
}

export async function ensureKatex(): Promise<void> {
  if (!loaded.katexCss) {
    loadStylesheet("vendor/katex/katex.min.css");
    loaded.katexCss = true;
  }
  if (loaded.katex && window.katex) return;
  await loadScript("vendor/katex/katex.min.js");
  loaded.katex = true;
}

export async function ensureHighlight(): Promise<void> {
  if (loaded.highlight && window.hljs) return;
  await loadScript("vendor/highlight/highlight.min.js");
  loaded.highlight = true;
}

export async function ensureMermaid(): Promise<void> {
  if (loaded.mermaid && window.mermaid) return;
  await loadScript("vendor/mermaid/mermaid.min.js");
  loaded.mermaid = true;
}

/** Run KaTeX over `.math` nodes. Mirrors katexRenderMathBody. */
export function renderMath(): void {
  if (!window.katex) return;
  document.querySelectorAll(".math").forEach((el) => {
    const htmlEl = el as HTMLElement;
    if (htmlEl.dataset.mathDone === "1") return;
    const tex = htmlEl.textContent ?? "";
    const display = htmlEl.classList.contains("math-display");
    try {
      window.katex!.render(tex, htmlEl, {
        displayMode: display,
        throwOnError: false,
        output: "htmlAndMathml",
      });
      htmlEl.dataset.mathDone = "1";
    } catch (err) {
      htmlEl.classList.add("math-error");
      htmlEl.textContent = String(
        (err as { message?: unknown } | null)?.message ?? err,
      );
      htmlEl.dataset.mathDone = "1";
    }
  });
  window.dispatchEvent(new Event("md-preview-math-rendered"));
}

/** Highlight code blocks via highlight.js. `langOf` resolves the fence
 * language (CodeFenceInfo highlightLanguage + content sniffing). */
export function highlightCode(
  langOf: (code: string, className: string) => string | undefined,
): void {
  if (!window.hljs) return;
  document.querySelectorAll("pre code").forEach((el) => {
    const codeEl = el as HTMLElement;
    if (codeEl.dataset.hljsDone === "1") return;
    const raw = codeEl.textContent ?? "";
    const lang = langOf(raw, codeEl.className);
    try {
      if (lang && window.hljs!.getLanguage(lang)) {
        codeEl.innerHTML = window.hljs!.highlight(raw, {
          language: lang,
        }).value;
      }
    } catch {
      // leave raw text on failure
    }
    codeEl.dataset.hljsDone = "1";
  });
}

/** Observe `.mermaid-figure` nodes and render them when near viewport.
 * Installs the wiring (queue/drain/renderAll/pan-zoom/HUD) from
 * renderer/mermaid.ts exactly once. */
export function observeMermaidFigures(): void {
  if (!window.mermaid || window.MdPreviewMermaid) return;
  // The wiring script is shipped as a module string; evaluate it in page
  // context so it sees the same `document`/`window`.
  void import("../renderer/mermaid").then((m) => {
    const script = document.createElement("script");
    script.textContent = m.mermaidInitWiring;
    document.body.appendChild(script);
  });
}

/** Force every mermaid figure to render (used before print/export). */
export async function renderAllMermaid(theme?: string): Promise<void> {
  await ensureMermaid();
  observeMermaidFigures();
  // Wiring installs async; wait a tick for MdPreviewMermaid.
  for (let i = 0; i < 50 && !window.MdPreviewMermaid; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  await window.MdPreviewMermaid?.renderAll(theme);
}

export function getVendorState(): VendorState {
  return { ...loaded };
}
