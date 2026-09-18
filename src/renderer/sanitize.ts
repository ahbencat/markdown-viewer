// DOMPurify configuration for the preview article.
//
// The vendor purify.min.js is loaded lazily from public/vendor. This module
// declares the allowlist additions the renderer needs on top of DOMPurify
// defaults — without them KaTeX/Mermaid output is stripped and the page
// goes blank (see plan risk b).
//
// The DOMPurify instance is injected (lazy script load in the browser,
// `dompurify` npm package only in tests) so this module stays framework-
// and environment-free.

export interface PurifyLike {
  sanitize(dirty: string, config?: Record<string, unknown>): string;
}

/** Tags/attributes DOMPurify must keep for KaTeX + Mermaid output. */
export const PURIFY_CONFIG = {
  ADD_TAGS: ["figure", "figcaption", "svg", "path", "g", "defs", "marker"],
  ADD_ATTR: [
    "style",
    "class",
    "tabindex",
    "role",
    "aria-label",
    "aria-hidden",
    "aria-pressed",
    "aria-describedby",
    "data-mm-act",
    "data-mm-done",
    "data-mm-theme",
    "data-math-done",
    "data-source-line",
    "data-source-start",
    "data-source-end",
    "viewBox",
    "preserveAspectRatio",
    "d",
    "fill",
    "stroke",
    "stroke-width",
    "transform",
    "x",
    "y",
    "width",
    "height",
    "cx",
    "cy",
    "r",
    "x1",
    "x2",
    "y1",
    "y2",
    "points",
    "dx",
    "dy",
    "text-anchor",
    "font-size",
    "font-family",
    "marker-start",
    "marker-end",
    "markerWidth",
    "markerHeight",
    "orient",
    "refX",
    "refY",
  ],
} as const;

export function sanitizeArticle(
  purify: PurifyLike,
  dirtyHtml: string,
): string {
  return purify.sanitize(dirtyHtml, {
    ADD_TAGS: [...PURIFY_CONFIG.ADD_TAGS],
    ADD_ATTR: [...PURIFY_CONFIG.ADD_ATTR],
  });
}
