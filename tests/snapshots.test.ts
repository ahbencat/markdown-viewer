// Snapshot regression: all 9 sample files render without leftover
// tokens and produce stable article HTML. Guards against parser drift
// (markdown-it upgrades) and pipeline regressions.
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import { renderMarkdown } from "../src/renderer/index";

const here = dirname(fileURLToPath(import.meta.url));
const samplesDir = here; // tests/*.md doubles as fixtures
const snapshotsDir = join(here, "__snapshots__");

const SAMPLE_FILES = [
  "bullet-marker-spacing.md",
  "codeblocks.md",
  "full.md",
  "long-footnotes.md",
  "mermaid-heavy.md",
  "navigation.md",
  "rendering-layout.md",
  "rtl-test.md",
  "toml-frontmatter.md",
];

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  // Same cast as src/renderer/index.ts (type-copy mismatch only).
}).use(footnote as unknown as (md: unknown) => void);

function snapshotPath(name: string): string {
  return join(snapshotsDir, `${name}.html.snap`);
}

describe("sample snapshots", () => {
  for (const name of SAMPLE_FILES) {
    it(name, async () => {
      const src = readFileSync(join(samplesDir, name), "utf8");
      const out = await renderMarkdown(src, { markdownIt: md });

      // No pipeline placeholders may survive.
      expect(out.articleHTML).not.toMatch(/MdPreview\w*\d+Token/);
      expect(out.articleHTML).not.toMatch(/__MDVIEW_LATEX__/);

      // Every doc produces non-empty output.
      expect(out.articleHTML.length).toBeGreaterThan(0);

      const snapFile = snapshotPath(name);
      if (process.env.UPDATE_SNAPSHOTS === "1" || !existsSync(snapFile)) {
        mkdirSync(snapshotsDir, { recursive: true });
        writeFileSync(snapFile, out.articleHTML);
      }
      const expected = readFileSync(snapFile, "utf8");
      expect(out.articleHTML).toBe(expected);
    });
  }

  it("frontmatter card present in toml sample", async () => {
    const src = readFileSync(join(samplesDir, "toml-frontmatter.md"), "utf8");
    const out = await renderMarkdown(src, { markdownIt: md });
    expect(out.articleHTML).toContain('class="md-frontmatter"');
    expect(out.articleHTML).toContain("TOML Frontmatter Test");
  });

  it("mermaid figures present in mermaid-heavy sample", async () => {
    const src = readFileSync(join(samplesDir, "mermaid-heavy.md"), "utf8");
    const out = await renderMarkdown(src, { markdownIt: md });
    expect(out.containsMermaid).toBe(true);
    expect(out.articleHTML).toContain("mermaid-figure");
  });

  it("rtl directions present in rtl sample", async () => {
    const src = readFileSync(join(samplesDir, "rtl-test.md"), "utf8");
    const out = await renderMarkdown(src, { markdownIt: md });
    expect(out.articleHTML).toContain('dir="rtl"');
  });
});
