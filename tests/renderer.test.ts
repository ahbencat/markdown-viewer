import { describe, expect, it } from "vitest";
import {
  parseFrontmatter,
  splitFrontmatter,
} from "../src/renderer/frontmatter";
import { extractMath, restoreMath } from "../src/renderer/math";
import { renderMermaidBlocks } from "../src/renderer/mermaid";
import {
  extractFootnotes,
  renderFootnoteReferences,
} from "../src/renderer/footnotes";
import {
  injectRTLDirection,
  sourceMayNeedRTLDirection,
} from "../src/renderer/rtl";
import {
  detectLanguage,
  highlightLanguage,
  parseCodeFenceInfo,
} from "../src/renderer/highlight";

describe("frontmatter", () => {
  it("splits YAML frontmatter", () => {
    const { raw, format, body } = splitFrontmatter(
      "---\ntitle: Hi\n---\n\n# Body\n",
    );
    expect(format).toBe("yaml");
    expect(raw).toBe("title: Hi");
    expect(body).toBe("\n# Body\n");
  });

  it("splits TOML frontmatter", () => {
    const { raw, format, body } = splitFrontmatter(
      '+++\ntitle = "TOML"\n+++\n\n# Body\n',
    );
    expect(format).toBe("toml");
    expect(raw).toBe('title = "TOML"');
    expect(body).toBe("\n# Body\n");
  });

  it("returns the whole doc when unclosed", () => {
    const src = "---\ntitle: Hi\n\n# Body\n";
    const { raw, format, body } = splitFrontmatter(src);
    expect(raw).toBeNull();
    expect(format).toBeNull();
    expect(body).toBe(src);
  });

  it("strips BOM", () => {
    const { format } = splitFrontmatter("﻿---\na: b\n---\nx");
    expect(format).toBe("yaml");
  });

  it("parses sequences and unquotes", () => {
    const entries = parseFrontmatter(
      'tags: ["a", \'b\']\ntitle: "Hi"\nempty:\n- x\n- y',
      "yaml",
    );
    expect(entries[0]).toMatchObject({
      key: "tags",
      value: "a, b",
      items: ["a", "b"],
    });
    expect(entries[1]).toMatchObject({ key: "title", value: "Hi" });
    expect(entries[2]).toMatchObject({ key: "empty", items: ["x", "y"] });
  });

  it("parses TOML key=value", () => {
    const entries = parseFrontmatter('title = "T"\ntags = ["a"]', "toml");
    expect(entries[0]).toMatchObject({ key: "title", value: "T" });
    expect(entries[1]).toMatchObject({ key: "tags", items: ["a"] });
  });
});

describe("math extraction", () => {
  it("extracts block and inline math, leaves $5 alone", () => {
    const src = "Price $5 and $10.\n\n$$x^2$$\n\nInline $a+b$ here.";
    const m = extractMath(src);
    expect(m.blocks).toEqual(["x^2"]);
    expect(m.inlines).toEqual(["a+b"]);
    expect(m.processedMarkdown).toContain("MdPreviewMathBlock0Token");
    expect(m.processedMarkdown).toContain("MdPreviewMathInline0Token");
    expect(m.processedMarkdown).toContain("$5");
  });

  it("does not extract inside fences or inline code", () => {
    const src = "```\n$x$\n```\n\n`$y$`\n\n$z$";
    const m = extractMath(src);
    expect(m.inlines).toEqual(["z"]);
    expect(m.processedMarkdown).toContain("$x$");
    expect(m.processedMarkdown).toContain("$y$");
  });

  it("restores tokens to containers", () => {
    const m = extractMath("$$x$$ and $y$");
    const html = `<p>${m.processedMarkdown}</p>`;
    const out = restoreMath(html, m, (latex, display) =>
      display ? `<D>${latex}</D>` : `<S>${latex}</S>`,
    );
    expect(out.containsMath).toBe(true);
    expect(out.html).toContain("<div");
    expect(out.html).toContain("<S>y</S>");
  });
});

describe("mermaid", () => {
  it("rewrites language-mermaid fences to figures", () => {
    const html = '<pre><code class="language-mermaid">graph TD</code></pre>';
    const out = renderMermaidBlocks(html);
    expect(out.containsMermaid).toBe(true);
    expect(out.html).toContain('class="mermaid-figure"');
    expect(out.html).toContain('data-mm-act="in"');
  });

  it("passes through without mermaid", () => {
    const out = renderMermaidBlocks("<p>hi</p>");
    expect(out.containsMermaid).toBe(false);
    expect(out.html).toBe("<p>hi</p>");
  });
});

describe("footnotes", () => {
  it("extracts definitions and numbers references", () => {
    const src = "Text[^a] more[^a] and[^b].\n\n[^a]: First\n[^b]: Second\n";
    const f = extractFootnotes(src);
    expect(f.definitions.map((d) => d.number)).toEqual([1, 2]);
    expect(f.references).toHaveLength(3);
    expect(f.markdown).toContain("MdPreviewFootnoteRef0Token");
    // definitions leave blank placeholders (4 lines removed -> 4 blanks)
    const html = renderFootnoteReferences(f.markdown, f);
    expect(html).toContain('id="fnref-1"');
    expect(html).toContain('id="fnref-1-2"');
    expect(html).toContain('href="#fn-2"');
  });

  it("ignores refs inside code", () => {
    const f = extractFootnotes("`[^a]`\n\n[^a]: x\n");
    expect(f.references).toHaveLength(0);
    expect(f.markdown).toContain("[^a]");
  });
});

describe("rtl", () => {
  it("gates on RTL source", () => {
    expect(sourceMayNeedRTLDirection("hello")).toBe(false);
    expect(sourceMayNeedRTLDirection("مرحبا")).toBe(true);
  });

  it("adds dir=rtl to RTL-first blocks only", () => {
    const html = "<p>مرحبا</p><p>hello</p>";
    const out = injectRTLDirection(html);
    expect(out).toContain('<p dir="rtl">');
    expect(out).toContain("<p>hello</p>");
  });
});

describe("code fence info", () => {
  it("parses language and metadata", () => {
    expect(parseCodeFenceInfo("python title=\"x\"")).toEqual({
      language: "python",
      metadata: 'title="x"',
    });
    expect(parseCodeFenceInfo(undefined)).toEqual({
      language: "",
      metadata: "",
    });
  });

  it("normalizes shell aliases", () => {
    expect(highlightLanguage("zsh")).toBe("bash");
    expect(highlightLanguage("python")).toBe("python");
  });

  it("detects languages from content", () => {
    expect(detectLanguage('{"a": 1}')).toBe("json");
    expect(detectLanguage("SELECT a FROM b")).toBe("sql");
    expect(detectLanguage("def f(x):\n  pass")).toBe("python");
    expect(detectLanguage("")).toBeUndefined();
  });
});
