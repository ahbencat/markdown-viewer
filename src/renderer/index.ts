// Top-level render pipeline. Mirrors MarkdownHTML.render in
// md-preview/Rendering/MarkdownHTML.swift:
//
//   splitFrontmatter → extractFootnotes → extractMath → markdown-it →
//   renderMermaidBlocks → restoreMath → renderFootnoteReferences →
//   renderFootnoteDefinitions → injectHeadingIDs → injectRTLDirection →
//   frontmatter card → assemble document
//
// markdown-it instance creation is lazy (first renderMarkdown call) so
// importing this module never requires the dependency at load time.

import { splitFrontmatter, renderFrontmatterCard } from "./frontmatter";
import { extractMath, restoreMath } from "./math";
import { renderMermaidBlocks } from "./mermaid";
import {
  extractFootnotes,
  renderFootnoteReferences,
  renderFootnoteDefinitions,
  type FootnoteExtraction,
} from "./footnotes";
import { injectRTLDirection, sourceMayNeedRTLDirection } from "./rtl";
import { sanitizeArticle, type PurifyLike } from "./sanitize";

export interface RenderedMarkdown {
  /** Full `<!DOCTYPE html>` document. */
  html: string;
  /** Article inner HTML (before sanitization concerns of the host). */
  articleHTML: string;
  containsMath: boolean;
  containsMermaid: boolean;
  containsCode: boolean;
}

export interface RenderOptions {
  /** Renders math tokens with KaTeX. Defaults to HTML-escaping the latex. */
  renderLatex?: (latex: string, displayMode: boolean) => string;
  /** Sanitizer instance (DOMPurify). When omitted, no sanitization runs —
   * pass the browser DOMPurify in production. */
  purify?: PurifyLike;
  /** Base href for relative asset resolution (the .md file's folder). */
  assetBaseHref?: string;
  /** markdown-it instance override (tests). */
  markdownIt?: MarkdownItLike;
}

export interface MarkdownItLike {
  render(src: string): string;
}

// markdown-it is loaded lazily so unit tests of the pure helpers never
// touch the dependency.
let cachedMarkdownIt: MarkdownItLike | null = null;

async function defaultMarkdownIt(): Promise<MarkdownItLike> {
  if (cachedMarkdownIt) return cachedMarkdownIt;
  const { default: MarkdownIt } = await import("markdown-it");
  const { default: footnote } = await import("markdown-it-footnote");
  // html:false + linkify:true + typographer:false matches the original:
  // raw HTML in the source is escaped, bare URLs autolink.
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    // @types/markdown-it (lib) vs markdown-it-footnote (dist) disagree on
    // the Plugin type; the footnote plugin is `(md) => void` at runtime.
  }).use(footnote as unknown as (md: unknown) => void);
  cachedMarkdownIt = md as MarkdownItLike;
  return cachedMarkdownIt;
}

function escapeHtml(s: string): string {
  let out = "";
  for (const ch of s) {
    switch (ch) {
      case "&":
        out += "&amp;";
        break;
      case "<":
        out += "&lt;";
        break;
      case ">":
        out += "&gt;";
        break;
      case '"':
        out += "&quot;";
        break;
      default:
        out += ch;
    }
  }
  return out;
}

const defaultRenderLatex = (latex: string, displayMode: boolean): string =>
  displayMode
    ? `<div class="math math-display">${escapeHtml(latex)}</div>`
    : `<span class="math math-inline">${escapeHtml(latex)}</span>`;

const highlightableCodeRe = /<pre\b[^>]*>\s*<code\b/i;

function detectHighlightableCode(html: string): boolean {
  return highlightableCodeRe.test(html);
}

const headingTagRe = /<h([1-6])([^>]*)>/g;

/** GFM task list items: `- [ ]` / `- [x]` → disabled checkboxes.
 * Mirrors the `<li class="task-list-item"><input …>` shape in
 * EscapingHTMLFormatter.swift. Runs on rendered `<li>` text nodes. */
function renderTaskLists(html: string): string {
  return html.replace(
    /<li>([ \t]*\[[ xX]\][ \t]*)/g,
    (_full, marker: string) => {
      const checked = marker.toLowerCase().includes("x");
      const checkbox =
        `<input type="checkbox" class="task-list-item-checkbox" disabled=""` +
        (checked ? " checked=\"\"" : "") +
        ">";
      return `<li class="task-list-item">${checkbox}`;
    },
  );
}

function injectHeadingIDs(html: string): string {
  let index = 0;
  return html.replace(
    headingTagRe,
    (_full, level: string, attributes: string) =>
      `<h${level}${attributes} id="md-heading-${index++}">`,
  );
}

/** Obsidian-style `==highlight==` → `<mark class="md-highlight">`.
 * Runs on the rendered HTML body text (not inside tags/attributes). */
function renderDoubleEqualsHighlight(html: string): string {
  // Split into tags vs text so `==` inside attributes is untouched.
  const parts = html.split(/(<[^>]+>)/g);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(/==([^=\n]+?)==/g, (_f, inner: string) => {
      // Skip code content that markdown-it already wrapped.
      return `<mark class="md-highlight">${inner}</mark>`;
    });
  }
  return parts.join("");
}

export async function renderMarkdown(
  markdown: string,
  opts: RenderOptions = {},
): Promise<RenderedMarkdown> {
  const renderLatex = opts.renderLatex ?? defaultRenderLatex;
  const md = opts.markdownIt ?? (await defaultMarkdownIt());

  const frontmatter = splitFrontmatter(markdown);
  const body = frontmatter.body;
  const footnotes: FootnoteExtraction = extractFootnotes(body);
  const math = extractMath(footnotes.markdown);

  const formatted = md.render(math.processedMarkdown);
  const mermaidResult = renderMermaidBlocks(formatted);
  const mathResult = restoreMath(mermaidResult.html, math, (latex, display) => {
    // restoreMath emits its own containers when given an identity renderer;
    // route through renderLatex directly on the latex source instead.
    void display;
    return `__MDVIEW_LATEX__${math.blocks.includes(latex) ? math.blocks.indexOf(latex) : "i" + math.inlines.indexOf(latex)}__`;
  });

  // Replace our indexed placeholders with the real latex rendering.
  let html = mathResult.html.replace(
    /__MDVIEW_LATEX__(i?)(\d+)__/g,
    (_f, inlineFlag: string, digits: string) => {
      const idx = Number(digits);
      const latex =
        inlineFlag === "i" ? math.inlines[idx] : math.blocks[idx];
      if (latex === undefined) return _f;
      return renderLatex(latex, inlineFlag !== "i");
    },
  );

  html = renderFootnoteReferences(html, footnotes);
  const footnoteSection = renderFootnoteDefinitions(footnotes, (content) => {
    const contentMath = extractMath(content);
    const contentHtml = md.render(contentMath.processedMarkdown);
    const contentMermaid = renderMermaidBlocks(contentHtml);
    const contentRestored = restoreMath(
      contentMermaid.html,
      contentMath,
      (latex, display) => renderLatex(latex, display),
    );
    return {
      html: contentRestored.html,
      containsMath: contentRestored.containsMath,
      containsMermaid: contentMermaid.containsMermaid,
    };
  });
  html += footnoteSection.html;

  html = injectHeadingIDs(html);
  html = renderTaskLists(html);
  html = renderDoubleEqualsHighlight(html);
  const renderedBodyHTML = sourceMayNeedRTLDirection(body)
    ? injectRTLDirection(html)
    : html;

  let frontmatterHTML = "";
  if (frontmatter.raw !== null && frontmatter.format !== null) {
    // sourceEndLine ≈ number of newlines before the body starts.
    const headLen = markdown.length - body.length;
    const sourceEndLine = markdown.slice(0, headLen).split("\n").length - 1;
    frontmatterHTML = renderFrontmatterCard(
      frontmatter.raw,
      frontmatter.format,
      sourceEndLine,
    );
  }

  const bodyHTML = frontmatterHTML + renderedBodyHTML;
  const containsMath =
    mathResult.containsMath || footnoteSection.containsMath;
  const containsMermaid =
    mermaidResult.containsMermaid || footnoteSection.containsMermaid;
  const containsCode = detectHighlightableCode(bodyHTML);

  const articleHTML =
    opts.purify !== undefined
      ? sanitizeArticle(opts.purify, bodyHTML)
      : bodyHTML;

  // Template-terminator hardening (mirrors the Swift `<\\/template`
  // escape): the article rides in an inert <template> in the full
  // document, so a case-insensitive `</template` must not survive.
  const safeBody = articleHTML.replace(/<\/template/gi, "<\\/template");

  const baseTag =
    opts.assetBaseHref !== undefined
      ? `<base href="${opts.assetBaseHref
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")}">`
      : "";

  const html_ = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${baseTag}
<link rel="stylesheet" href="md-view-win.css">
</head>
<body>
<article class="markdown-body"></article>
<template id="md-article-source">${safeBody}</template>
<script src="vendor/purify.min.js"></script>
<script src="md-view-win.js"></script>
</body>
</html>`;

  return {
    html: html_,
    articleHTML,
    containsMath,
    containsMermaid,
    containsCode,
  };
}
