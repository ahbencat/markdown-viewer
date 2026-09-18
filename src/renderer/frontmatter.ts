// Ported from md-preview/Rendering/MarkdownFrontmatter.swift + the
// renderFrontmatter helper in MarkdownHTML+Utils.swift.
//
// Best-effort parse: each top-level `key: value` line becomes an entry;
// indented continuation lines append to the previous value, `- item`
// lines and `[a, b]` flow sequences become the entry's items. We don't
// interpret other YAML types — scalars are shown verbatim (unquoted).

export type FrontmatterFormat = "yaml" | "toml";

export interface FrontmatterEntry {
  id: number;
  key: string;
  value: string;
  /** Non-nil when the value is a sequence. `value` then carries the items
   * joined with ", " for plain-text consumers. */
  items?: string[];
}

export interface FrontmatterSplit {
  raw: string | null;
  format: FrontmatterFormat | null;
  body: string;
}

const BOM = "﻿";

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function splitFrontmatter(markdown: string): FrontmatterSplit {
  const stripped = markdown.startsWith(BOM) ? markdown.slice(1) : markdown;
  const firstLineEnd = stripped.search(/\n/);
  const firstLine =
    firstLineEnd === -1 ? stripped : stripped.slice(0, firstLineEnd);
  const delimiter = parseOpeningLine(firstLine.trim());
  if (delimiter === null) return { raw: null, format: null, body: markdown };

  const lines = stripped.split("\n");
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (closesDelimiter(delimiter, lines[i].trim())) {
      close = i;
      break;
    }
  }
  if (close === -1) return { raw: null, format: null, body: markdown };

  return {
    raw: lines.slice(1, close).join("\n"),
    format: delimiter,
    body: lines.slice(close + 1).join("\n"),
  };
}

function parseOpeningLine(trimmed: string): FrontmatterFormat | null {
  if (trimmed === "---") return "yaml";
  if (trimmed === "+++") return "toml";
  return null;
}

function closesDelimiter(
  delimiter: FrontmatterFormat,
  trimmedLine: string,
): boolean {
  if (delimiter === "yaml") {
    return trimmedLine === "---" || trimmedLine === "...";
  }
  return trimmedLine === "+++";
}

export function parseFrontmatter(
  raw: string,
  format: FrontmatterFormat = "yaml",
): FrontmatterEntry[] {
  return format === "yaml" ? parseYaml(raw) : parseToml(raw);
}

function parseYaml(raw: string): FrontmatterEntry[] {
  const entries: { key: string; value: string; items: string[] }[] = [];
  for (const rawLine of normalizeNewlines(raw).split("\n")) {
    const line = rawLine;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    // Sequence items belong to the previous key. YAML allows them
    // at the key's own indent or deeper, so match before the
    // continuation-line rule below.
    if ((trimmed === "-" || trimmed.startsWith("- ")) && entries.length > 0) {
      const item = unquote(trimmed.slice(1).trim());
      if (item !== "") entries[entries.length - 1].items.push(item);
      continue;
    }

    if (
      (line.startsWith(" ") || line.startsWith("\t")) &&
      entries.length > 0
    ) {
      const prev = entries[entries.length - 1].value;
      entries[entries.length - 1].value =
        prev === "" ? trimmed : `${prev} ${trimmed}`;
      continue;
    }

    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (key === "") continue;

    const flowItems = flowSequenceItems(value);
    if (flowItems !== null) {
      entries.push({ key, value: "", items: flowItems });
      continue;
    }

    if (BLOCK_SCALAR_INDICATORS.has(value)) {
      // `key: >-` etc. — the value is the indented block that
      // follows; continuation lines fill it in, folded with spaces.
      value = "";
    } else if (
      !value.startsWith('"') &&
      !value.startsWith("'") &&
      value.includes(" #")
    ) {
      value = value.slice(0, value.indexOf(" #")).trim();
    }
    entries.push({ key, value: unquote(value), items: [] });
  }
  return entries.map((entry, index) => ({
    id: index,
    key: entry.key,
    value:
      entry.items.length > 0
        ? entry.items.join(", ")
        : entry.value,
    ...(entry.items.length > 0 ? { items: entry.items } : {}),
  }));
}

function parseToml(raw: string): FrontmatterEntry[] {
  const entries: FrontmatterEntry[] = [];
  for (const rawLine of normalizeNewlines(raw).split("\n")) {
    const line = rawLine;
    const trimmed = line.trim();
    if (
      trimmed === "" ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("[")
    )
      continue;

    const equals = line.indexOf("=");
    if (equals === -1) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim();
    if (key === "") continue;

    const items = flowSequenceItems(value);
    if (items !== null) {
      entries.push({
        id: entries.length,
        key,
        value: items.join(", "),
        items,
      });
    } else {
      entries.push({
        id: entries.length,
        key,
        value: unquote(value),
      });
    }
  }
  return entries;
}

const BLOCK_SCALAR_INDICATORS = new Set(["|", "|-", "|+", ">", ">-", ">+"]);

/** `["a", "b"]` → `["a", "b"]`. Null unless the value is a simple flow
 * sequence — nested collections stay verbatim scalars. */
function flowSequenceItems(value: string): string[] | null {
  if (!value.startsWith("[") || !value.endsWith("]")) return null;
  const inner = value.slice(1, -1);
  if (inner.includes("[") || inner.includes("{")) return null;

  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of inner) {
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      items.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  items.push(current);
  return items
    .map((item) => unquote(item.trim()))
    .filter((item) => item !== "");
}

function unquote(value: string): string {
  if (
    value.length >= 2 &&
    (value[0] === '"' || value[0] === "'") &&
    value[0] === value[value.length - 1]
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function escapeHtml(s: string): string {
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

/** Renders the frontmatter card (`<section class="md-frontmatter">`) that
 * sits above the article body. Mirrors renderFrontmatter in
 * MarkdownHTML+Utils.swift. Returns "" when there are no entries. */
export function renderFrontmatterCard(
  raw: string,
  format: FrontmatterFormat,
  sourceEndLine: number,
): string {
  const entries = parseFrontmatter(raw, format);
  if (entries.length === 0) return "";

  const rows = entries
    .map((entry) => {
      let valueHTML: string;
      if (entry.items) {
        valueHTML = entry.items
          .map(
            (item) =>
              `<span class="md-fm-pill" dir="auto">${escapeHtml(item)}</span>`,
          )
          .join("");
      } else if (entry.value === "") {
        valueHTML = `<span class="md-fm-empty" aria-hidden="true"></span>`;
      } else {
        valueHTML = escapeHtml(entry.value);
      }
      return `<tr><th scope="row" dir="auto">${escapeHtml(entry.key)}</th><td dir="auto">${valueHTML}</td></tr>`;
    })
    .join("\n");

  return `<section class="md-frontmatter" data-source-line="1" data-source-start="1" data-source-end="${Math.max(1, sourceEndLine)}">
<table><tbody>
${rows}
</tbody></table>
</section>

`;
}
