// Ported from md-preview/Rendering/MarkdownHTML+Footnotes.swift.
//
// Footnote extraction and rendering. swift-markdown has no GFM footnote
// notion, and neither does markdown-it core — so definitions are extracted
// before parsing, references become tokens, and the definition section is
// rendered separately. (We do this ourselves rather than using
// markdown-it-footnote so numbering/backref markup matches the original.)

import {
  codeFenceRegex,
  inlineCodeRegex,
  restoreIndexedTokens,
} from "./math";

export interface FootnoteDefinition {
  key: string;
  label: string;
  content: string;
  number: number;
}

export interface FootnoteReference {
  number: number;
  ordinal: number;
}

export interface FootnoteExtraction {
  markdown: string;
  definitions: FootnoteDefinition[];
  references: FootnoteReference[];
}

export interface FootnoteSection {
  html: string;
  containsMath: boolean;
  containsMermaid: boolean;
}

const footnoteDefinitionRegex = /^[ \t]{0,3}\[\^([^\]\n]+)\]:[ \t]*(.*)$/;
const footnoteReferenceRegex = /\[\^([^\]\n]+)\]/g;

const FOOTNOTE_PROTECT_PREFIX = "MdPreviewFootnoteProtect";
const TOKEN_SUFFIX = "Token";
const REF_TOKEN = (i: number) => `MdPreviewFootnoteRef${i}Token`;

function normalizeFootnoteKey(label: string): string {
  return label.trim().toLowerCase();
}

export function extractFootnotes(markdown: string): FootnoteExtraction {
  if (!markdown.includes("[^")) {
    return { markdown, definitions: [], references: [] };
  }

  const split = splitFootnoteDefinitions(markdown);
  const protectedParts: string[] = [];

  const protect = (full: string): string => {
    protectedParts.push(full);
    return `${FOOTNOTE_PROTECT_PREFIX}${protectedParts.length - 1}${TOKEN_SUFFIX}`;
  };

  const afterFences = split.markdown.replace(codeFenceRegex, (full) =>
    protect(full),
  );
  const afterInlineCode = afterFences.replace(inlineCodeRegex, (full) =>
    protect(full),
  );

  const orderedDefinitions: FootnoteDefinition[] = [];
  const referenceOrdinalsByNumber = new Map<number, number>();
  const references: FootnoteReference[] = [];

  const replacedReferences = afterInlineCode.replace(
    footnoteReferenceRegex,
    (full, label: string) => {
      const key = normalizeFootnoteKey(label);
      const stored = split.definitions.get(key);
      if (!stored) return full;

      let definition = orderedDefinitions.find((d) => d.key === key);
      if (!definition) {
        definition = {
          key,
          label: stored.label,
          content: stored.content,
          number: orderedDefinitions.length + 1,
        };
        orderedDefinitions.push(definition);
      }

      const ordinal = (referenceOrdinalsByNumber.get(definition.number) ?? 0) + 1;
      referenceOrdinalsByNumber.set(definition.number, ordinal);
      const token = REF_TOKEN(references.length);
      references.push({ number: definition.number, ordinal });
      return token;
    },
  );

  const restored = restoreIndexedTokens(
    replacedReferences,
    FOOTNOTE_PROTECT_PREFIX,
    TOKEN_SUFFIX,
    protectedParts,
  );

  return { markdown: restored, definitions: orderedDefinitions, references };
}

function splitFootnoteDefinitions(markdown: string): {
  markdown: string;
  definitions: Map<string, { label: string; content: string }>;
} {
  const lines = markdown.split("\n");
  const output: string[] = [];
  const definitions = new Map<string, { label: string; content: string }>();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const match = footnoteDefinitionRegex.exec(line);
    if (match) {
      const definitionStartIndex = index;
      const label = match[1];
      const contentLines = [match[2]];
      index += 1;

      while (index < lines.length) {
        const continuation = lines[index];
        if (continuation.trim() === "") {
          if (
            index + 1 < lines.length &&
            isIndentedFootnoteContinuation(lines[index + 1])
          ) {
            contentLines.push("");
            index += 1;
            continue;
          }
          break;
        }
        if (!isIndentedFootnoteContinuation(continuation)) break;
        contentLines.push(stripFootnoteContinuationIndent(continuation));
        index += 1;
      }

      definitions.set(normalizeFootnoteKey(label), {
        label,
        content: contentLines.join("\n"),
      });
      // Keep one blank placeholder for every removed source line so ranges
      // for all following blocks continue to match the original document.
      for (let i = 0; i < index - definitionStartIndex; i++) output.push("");
    } else {
      output.push(line);
      index += 1;
    }
  }

  return { markdown: output.join("\n"), definitions };
}

function isIndentedFootnoteContinuation(line: string): boolean {
  if (line.startsWith("\t")) return true;
  return line.length >= 4 && line.slice(0, 4) === "    ";
}

function stripFootnoteContinuationIndent(line: string): string {
  if (line.startsWith("\t")) return line.slice(1);
  if (line.length >= 4 && line.slice(0, 4) === "    ") return line.slice(4);
  return line;
}

export function renderFootnoteReferences(
  html: string,
  footnotes: FootnoteExtraction,
): string {
  if (footnotes.references.length === 0) return html;
  // Restore reference tokens sequentially: token N ↔ references[N].
  let i = 0;
  return html.replace(
    /MdPreviewFootnoteRef(\d+)Token/g,
    (full, digits: string) => {
      const refIndex = Number(digits);
      const reference = footnotes.references[refIndex];
      if (!reference) return full;
      void i;
      const refID = footnoteReferenceID(reference.number, reference.ordinal);
      const footnoteID = footnoteDefinitionID(reference.number);
      return `<sup class="footnote-ref"><a id="${refID}" href="#${footnoteID}" aria-label="Footnote ${reference.number}">${reference.number}</a></sup>`;
    },
  );
}

/** Renders the `<section class="footnotes">` block. `renderContent` runs a
 * single definition's markdown through the body pipeline
 * (math → markdown-it → mermaid) and reports vendor flags. */
export function renderFootnoteDefinitions(
  footnotes: FootnoteExtraction,
  renderContent: (markdown: string) => {
    html: string;
    containsMath: boolean;
    containsMermaid: boolean;
  },
): FootnoteSection {
  if (footnotes.definitions.length === 0) {
    return { html: "", containsMath: false, containsMermaid: false };
  }

  let containsMath = false;
  let containsMermaid = false;
  const referencesByNumber = new Map<number, FootnoteReference[]>();
  for (const ref of footnotes.references) {
    const list = referencesByNumber.get(ref.number) ?? [];
    list.push(ref);
    referencesByNumber.set(ref.number, list);
  }

  const items = footnotes.definitions
    .map((definition) => {
      const renderedContent = renderContent(definition.content.trim());
      containsMath = containsMath || renderedContent.containsMath;
      containsMermaid = containsMermaid || renderedContent.containsMermaid;
      const backrefs = (referencesByNumber.get(definition.number) ?? [])
        .map(
          (reference) =>
            `<a href="#${footnoteReferenceID(reference.number, reference.ordinal)}" class="footnote-backref" aria-label="Back to reference ${reference.number}">&#8617;</a>`,
        )
        .join(" ");
      const contentHTML = appendFootnoteBackrefs(backrefs, renderedContent.html);
      return `<li id="${footnoteDefinitionID(definition.number)}">
${contentHTML}
</li>`;
    })
    .join("\n");

  return {
    html: `
<section class="footnotes" role="doc-endnotes">
<hr />
<ol>
${items}
</ol>
</section>`,
    containsMath,
    containsMermaid,
  };
}

function appendFootnoteBackrefs(backrefs: string, html: string): string {
  if (backrefs === "") return html;
  const inlineBackrefs = `<span class="footnote-backrefs">${backrefs}</span>`;
  const idx = html.lastIndexOf("</p>");
  if (idx !== -1) {
    return html.slice(0, idx) + ` ${inlineBackrefs}</p>` + html.slice(idx + 4);
  }
  return html + inlineBackrefs;
}

function footnoteDefinitionID(number: number): string {
  return `fn-${number}`;
}

function footnoteReferenceID(number: number, ordinal: number): string {
  return ordinal === 1 ? `fnref-${number}` : `fnref-${number}-${ordinal}`;
}
