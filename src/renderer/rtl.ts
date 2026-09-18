// Ported from md-preview/Rendering/MarkdownHTML+RTL.swift.
//
// Right-to-left direction detection and dir attribute injection.

const rtlTagRegex = /<(blockquote|p|li|h[1-6])(\s[^>]*)?>/gi;
const htmlTagRegex = /<[^>]+>/g;

// RTL Unicode ranges: Hebrew, Arabic (+ supplements), Syriac, Thaana, N'Ko,
// Samaritan, Mandaic. Mirrors rtlRanges in MarkdownHTML+RTL.swift.
const RTL_RANGES: [number, number][] = [
  [0x0590, 0x05ff],
  [0x0600, 0x06ff],
  [0x0700, 0x074f],
  [0x0750, 0x077f],
  [0x0780, 0x07bf],
  [0x07c0, 0x07ff],
  [0x0800, 0x083f],
  [0x0840, 0x085f],
  [0x08a0, 0x08ff],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
];

function isRtlCodePoint(cp: number): boolean {
  return RTL_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

/** Over-inclusive by design: CommonMark decodes numeric character
 * references before formatting, so any `&#` might become RTL text.
 * False positives only take the existing slow path; false negatives
 * would skip direction inference. */
export function sourceMayNeedRTLDirection(source: string): boolean {
  let previousWasAmpersand = false;
  for (const ch of source) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x0590 && cp <= 0xfeff && isRtlCodePoint(cp)) return true;
    if (previousWasAmpersand && cp === 0x23) return true;
    previousWasAmpersand = cp === 0x26;
  }
  return false;
}

function stripHtmlTags(html: string): string {
  return html.replace(htmlTagRegex, "");
}

// Unicode General_Category values that count as "strong" for the
// first-strong-character heuristic. The original uses Swift's
// Character.properties.generalCategory; here we approximate with a
// regex over Unicode letter (L*) and mark (M*) categories.
const STRONG_CHAR_RE = /[\p{Lu}\p{Ll}\p{Lt}\p{Lm}\p{Lo}\p{Mn}\p{Mc}\p{Me}]/u;

function firstStrongCharacter(text: string): string | undefined {
  const m = STRONG_CHAR_RE.exec(text);
  return m ? m[0] : undefined;
}

export function injectRTLDirection(html: string): string {
  rtlTagRegex.lastIndex = 0;
  const matches: { index: number; length: number; tag: string; attrs: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = rtlTagRegex.exec(html)) !== null) {
    matches.push({
      index: m.index,
      length: m[0].length,
      tag: m[1],
      attrs: m[2] ?? "",
    });
  }
  if (matches.length === 0) return html;

  let result = "";
  let cursor = 0;
  for (const match of matches) {
    result += html.slice(cursor, match.index);
    const full = html.slice(match.index, match.index + match.length);
    if (match.attrs.toLowerCase().includes("dir=")) {
      result += full;
    } else {
      const contentStart = match.index + match.length;
      const contentPreview = html.slice(contentStart, contentStart + 300);
      const plainText = stripHtmlTags(contentPreview);
      const first = firstStrongCharacter(plainText);
      if (
        first !== undefined &&
        isRtlCodePoint(first.codePointAt(0) ?? 0)
      ) {
        result += `<${match.tag}${match.attrs} dir="rtl">`;
      } else {
        result += full;
      }
    }
    cursor = match.index + match.length;
  }
  result += html.slice(cursor);
  return result;
}
