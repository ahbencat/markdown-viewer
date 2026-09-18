// Ported from md-preview/Rendering/MarkdownHTML+Math.swift.
//
// KaTeX math extraction ("take out before Markdown parsing, restore after")
// and block rendering.
//
// Pipeline position (mirrors MarkdownHTML.render):
//   extractMath(markdown) → markdown-it → mermaid post-process →
//   restoreMath(html, extraction) → KaTeX HTML
//
// Simplifications vs the Swift original:
// - The link-label `\[` protection used swift-markdown's AST to find link
//   ranges; here we approximate with a regex for `[...](...)` labels because
//   markdown-it renders links natively and `\[` inside a label would already
//   be consumed as an escape. Kept conservative: only protect when the
//   brackets look like a link label followed by `(`.
// - Source-line bookkeeping (blockLineCounts / data-source attributes) is
//   dropped: the MVP has no scroll-sync or editor.

export interface MathExtraction {
  processedMarkdown: string;
  blocks: string[];
  inlines: string[];
}

export interface MathRenderResult {
  html: string;
  containsMath: boolean;
}

// Fenced code block. Group 1 = backtick run, group 2 = info string,
// group 3 = body. Mirrors codeFenceRegex in MarkdownHTML+Utils.swift.
const codeFenceRegex = /^(```+)[ \t]*([^\n`]*)\n([\s\S]*?)\n\1[ \t]*$/gm;

// Inline code span: matched-length backtick runs not adjacent to other
// backticks. Mirrors inlineCodeRegex in MarkdownHTML+Utils.swift.
const inlineCodeRegex = /(?<!`)(`+)(?!`)([^\n]*?)(?<!`)\1(?!`)/g;

const blockMathDollar = /\$\$([\s\S]+?)\$\$/g;
// `\[...\]` display math (single backslash), not preceded by a backslash.
const blockMathBracket = /(?<!\\)\\\[([\s\S]+?)\\\]/g;
// `\\[...\\]` (markdown-escaped form), exactly two backslashes.
const blockMathEscapedBracket = /(?<!\\)\\\\\[([\s\S]+?)\\\\\]/g;
// `$...$`: no leading `\$`, non-space adjacent to delimiters so prose
// like "$5 and $10" doesn't match.
const inlineMathDollar = /(?<!\\)\$(?=\S)([^$\n]+?)(?<=\S)\$/g;
// `\(...\)` and `\\(...\\)` forms.
const inlineMathParen = /(?<!\\)\\\(([^\\\n]+?)\\\)/g;
const inlineMathEscapedParen = /(?<!\\)\\\\\(([^\\\n]+?)\\\\\)/g;

const PROTECT_PREFIX = "MdPreviewProtect";
const TOKEN_SUFFIX = "Token";
const BLOCK_TOKEN = (i: number) => `MdPreviewMathBlock${i}Token`;
const INLINE_TOKEN = (i: number) => `MdPreviewMathInline${i}Token`;

export function extractMath(markdown: string): MathExtraction {
  const blocks: string[] = [];
  const inlines: string[] = [];
  const protectedParts: string[] = [];

  const protect = (full: string): string => {
    protectedParts.push(full);
    return `${PROTECT_PREFIX}${protectedParts.length - 1}${TOKEN_SUFFIX}`;
  };

  // Link labels: `\[` / `\]` inside `[...](...)` are bracket escapes, not
  // display-math delimiters. Protect those ranges before the math pass.
  let text = markdown.replace(
    /(\[[^\]\n]*\\[[^\]\n]*\])(?=\s*\()/g,
    protect,
  );

  // Fenced code blocks: ```math fences become block tokens, everything
  // else is protected verbatim.
  // NOTE: a ```math fence with no body still counts as a block (empty latex).
  text = text.replace(
    /^(```+)[ \t]*([^\n`]*)\n([\s\S]*?)\n\1[ \t]*$/gm,
    (full, _ticks, info: string, body: string) => {
      const language = info.trim().split(/\s/, 1)[0]?.toLowerCase() ?? "";
      if (language === "math") {
        blocks.push(body);
        const newlines = (full.match(/\n/g) ?? []).length;
        return BLOCK_TOKEN(blocks.length - 1) + "\n".repeat(newlines);
      }
      return protect(full);
    },
  );

  // Inline code spans next, so $..$ inside `` `$x$` `` is not extracted.
  text = text.replace(inlineCodeRegex, (full) => protect(full));

  const extractBlocks = (re: RegExp, source: string): string =>
    source.replace(re, (full, capture: string) => {
      const newlines = (full.match(/\n/g) ?? []).length;
      blocks.push(capture);
      return BLOCK_TOKEN(blocks.length - 1) + "\n".repeat(newlines);
    });

  text = extractBlocks(blockMathDollar, text);
  text = extractBlocks(blockMathEscapedBracket, text);
  text = extractBlocks(blockMathBracket, text);

  const extractInline = (re: RegExp, source: string): string =>
    source.replace(re, (_full, capture: string) => {
      inlines.push(capture);
      return INLINE_TOKEN(inlines.length - 1);
    });

  text = extractInline(inlineMathDollar, text);
  text = extractInline(inlineMathEscapedParen, text);
  text = extractInline(inlineMathParen, text);

  const processedMarkdown = restoreIndexedTokens(
    text,
    PROTECT_PREFIX,
    TOKEN_SUFFIX,
    protectedParts,
  );

  return { processedMarkdown, blocks, inlines };
}

/** Restores math tokens in rendered HTML to KaTeX-ready containers.
 * `renderLatex` converts a latex string to HTML (KaTeX renderToString in
 * production, identity/escape in tests). Mirrors renderMathBlocks. */
export function restoreMath(
  html: string,
  math: MathExtraction,
  renderLatex: (latex: string, displayMode: boolean) => string,
): MathRenderResult {
  if (math.blocks.length === 0 && math.inlines.length === 0) {
    return { html, containsMath: false };
  }
  // Matches `<p ...>MdPreviewMath(Block|Inline)NToken</p>` (paragraph-wrapped,
  // the common case) or a bare token. The wrapper is stripped for block kind
  // to keep the resulting `<div>` out of an enclosing `<p>`.
  const tokenRe =
    /<p\b([^>]*)>MdPreviewMath(Block|Inline)(\d+)Token<\/p>|MdPreviewMath(Block|Inline)(\d+)Token/g;
  let found = false;
  const rebuilt = html.replace(
    tokenRe,
    (full, _attrs, kindA, indexA, kindB, indexB) => {
      const wrapped = kindA !== undefined;
      const isBlock = (wrapped ? kindA : kindB) === "Block";
      const index = Number(wrapped ? indexA : indexB);
      const latex = isBlock ? math.blocks[index] : math.inlines[index];
      if (latex === undefined) return full;
      found = true;
      const rendered = renderLatex(latex, isBlock);
      return isBlock
        ? `<div class="math math-display">${rendered}</div>`
        : `<span class="math math-inline">${rendered}</span>`;
    },
  );
  return { html: rebuilt, containsMath: found };
}

/** Single-forward-pass placeholder restoration. Mirrors restoreIndexedTokens
 * in MarkdownHTML+Utils.swift: re-running replace once per token scales
 * quadratically on large documents. */
export function restoreIndexedTokens(
  source: string,
  prefix: string,
  suffix: string,
  replacements: string[],
): string {
  if (replacements.length === 0 || !source.includes(prefix)) return source;
  let result = "";
  let cursor = 0;
  for (;;) {
    const tokenStart = source.indexOf(prefix, cursor);
    if (tokenStart === -1) break;
    result += source.slice(cursor, tokenStart);
    let digitsEnd = tokenStart + prefix.length;
    while (digitsEnd < source.length && isDigit(source[digitsEnd])) {
      digitsEnd++;
    }
    const indexStr = source.slice(tokenStart + prefix.length, digitsEnd);
    if (
      digitsEnd > tokenStart + prefix.length &&
      source.startsWith(suffix, digitsEnd) &&
      /^\d+$/.test(indexStr)
    ) {
      const index = Number(indexStr);
      if (index >= 0 && index < replacements.length) {
        result += replacements[index];
        cursor = digitsEnd + suffix.length;
        continue;
      }
    }
    // This prefix can appear in authored Markdown. Preserve it and
    // continue searching after the prefix.
    result += prefix;
    cursor = tokenStart + prefix.length;
  }
  result += source.slice(cursor);
  return result;
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

export { codeFenceRegex, inlineCodeRegex };
