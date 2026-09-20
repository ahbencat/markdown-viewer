import { describe, expect, it } from "vitest";
import {
  MARKDOWN_EXTENSIONS,
  isMarkdownPath,
} from "../src/platform/tauri";

describe("isMarkdownPath", () => {
  it("accepts every extension the open dialog offers", () => {
    for (const ext of MARKDOWN_EXTENSIONS) {
      expect(isMarkdownPath(`notes.${ext}`)).toBe(true);
    }
  });

  it("matches case-insensitively", () => {
    expect(isMarkdownPath("NOTES.MD")).toBe(true);
    expect(isMarkdownPath("Notes.Markdown")).toBe(true);
  });

  it("handles Windows and POSIX paths", () => {
    expect(isMarkdownPath("C:\\Users\\me\\docs\\a.markdown")).toBe(true);
    expect(isMarkdownPath("/home/me/docs/a.mdown")).toBe(true);
    // A dot in a directory name must not be mistaken for an extension.
    expect(isMarkdownPath("C:\\my.docs\\README")).toBe(false);
  });

  it("rejects non-Markdown and extensionless names", () => {
    expect(isMarkdownPath("archive.tar.gz")).toBe(false);
    expect(isMarkdownPath("image.png")).toBe(false);
    expect(isMarkdownPath("README")).toBe(false);
    expect(isMarkdownPath("")).toBe(false);
  });

  it("treats a leading dot as a dotfile, not an extension", () => {
    expect(isMarkdownPath(".gitignore")).toBe(false);
    expect(isMarkdownPath("C:\\repo\\.hidden")).toBe(false);
  });

  it("uses the final extension when there are several", () => {
    expect(isMarkdownPath("notes.md.txt")).toBe(true);
    expect(isMarkdownPath("notes.txt.png")).toBe(false);
  });
});
