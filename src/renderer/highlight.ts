// Ported from md-preview/Rendering/CodeFenceInfo.swift.
//
// Parsed components of a CommonMark fenced code block info string, plus
// conservative content-based language detection used only when a fence
// has no info string.

export interface CodeFenceInfo {
  /** First whitespace-separated token of the info string, lowercased.
   * Empty when the info string is missing or whitespace-only. */
  language: string;
  /** Remainder of the info string after the language word, trimmed.
   * Empty when there is no metadata. */
  metadata: string;
}

export function parseCodeFenceInfo(rawInfoString?: string): CodeFenceInfo {
  if (rawInfoString === undefined || rawInfoString === null) {
    return { language: "", metadata: "" };
  }
  const trimmed = rawInfoString.trim();
  const split = trimmed.search(/\s/);
  if (split === -1) {
    return { language: trimmed.toLowerCase(), metadata: "" };
  }
  return {
    language: trimmed.slice(0, split).toLowerCase(),
    metadata: trimmed.slice(split).trim(),
  };
}

/** Language identifier passed to the read-mode highlighter.
 *
 * CodeMirror treats these common shell fence names as one shell grammar,
 * while highlight.js reserves `shell` and `console` for transcript-style
 * input. Normalize them so both modes parse the same source as shell code. */
export function highlightLanguage(language: string): string {
  switch (language) {
    case "shell":
    case "sh":
    case "zsh":
    case "console":
      return "bash";
    default:
      return language;
  }
}

/** Conservative content-based detection used only when a fence has no info
 * string. Explicit fence languages always remain the source of truth. */
export function detectLanguage(source: string): string | undefined {
  const text = source.trim();
  if (text === "") return undefined;

  if (matches(/^(#!.*\b(?:ba)?sh\b|^\s*\$\s+)/m, text)) return "bash";
  if (
    (text.startsWith("{") && text.endsWith("}")) ||
    (text.startsWith("[") && text.endsWith("]"))
  ) {
    try {
      JSON.parse(text);
      return "json";
    } catch {
      // not JSON — fall through
    }
  }
  if (matches(/^\s*(?:<!DOCTYPE\s+html|<html\b|<(?:div|span|section|article)\b)/m, text))
    return "html";
  if (
    matches(
      /\b(?:resource|data|provider|variable|module)\s+"[\w-]+"(?:\s+"[\w-]+")?\s*\{|\bterraform\s*\{/,
      text,
    )
  )
    return "hcl";
  if (
    matches(
      /\b(?:import\s+Foundation|func\s+\w+\s*\(|@main)\b|\b(?:let|var)\s+\w+\s*:\s*(?:String|Int|Bool|Double|Float)\b/,
      text,
    )
  )
    return "swift";
  if (
    matches(
      /^\s*(?:#\s*include\s*<iostream>|(?:using\s+namespace\s+std|std::\w+|(?:cout|cin)\s*(?:<<|>>))\b)/m,
      text,
    )
  )
    return "cpp";
  if (
    matches(
      /^\s*(?:#\s*include\s*[<"](?:assert|ctype|errno|float|inttypes|limits|math|setjmp|signal|stdarg|stdbool|stddef|stdint|stdio|stdlib|string|time)\.h[>"]|(?:int|void)\s+main\s*\([^)]*\)\s*\{)/m,
      text,
    )
  )
    return "c";
  if (
    matches(
      /^\s*(?:async\s+)?def\s+\w+\s*\(|^\s*from\s+\w[\w.]*\s+import\b|^\s*class\s+\w+\s*[:()]/m,
      text,
    )
  )
    return "python";
  if (
    matches(
      /\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE\s+(?:TABLE|VIEW|INDEX)|WITH)\b[\s\S]*\b(?:FROM|INTO|WHERE|AS)\b/i,
      text,
    )
  )
    return "sql";
  if (
    matches(/(?:^|\n)\s*(?:[#.]?[A-Za-z][\w-]*)\s*\{[\s\S]*:[\s\S]*\}/m, text) ||
    matches(/@(?:media|keyframes|supports)\b/, text)
  )
    return "css";
  if (
    matches(/^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=\n]+)?\s*=/m, text) ||
    matches(/\b(?:function\s+\w+\s*\(|console\.(?:log|error|warn)|=>)/, text)
  )
    return "javascript";
  if (
    matches(/^\s*(?:[-A-Za-z_][\w-]*):\s*(?:[^:#\n]|$)/m, text) &&
    !text.includes("{") &&
    !text.includes(";")
  )
    return "yaml";
  if (matches(/^\s*(?:echo|printf|export|source|cd|mkdir|rm|cp|mv)\s+/, text))
    return "bash";
  return undefined;
}

function matches(pattern: RegExp, source: string): boolean {
  // The Swift original passes [.regularExpression, .caseInsensitive] for
  // every pattern, so force the `i` flag here regardless of the input.
  const flags = pattern.flags.includes("i") ? pattern.flags : pattern.flags + "i";
  return new RegExp(pattern.source, flags).test(source);
}
