import { describe, expect, it } from "vitest";
import {
  classifyImageSrc,
  normalizeImagePath,
} from "../src/platform/tauri";

describe("classifyImageSrc", () => {
  it("passes remote URLs through", () => {
    expect(classifyImageSrc("https://example.com/a.png")).toBe("remote");
    expect(classifyImageSrc("http://example.com/a.png")).toBe("remote");
    expect(classifyImageSrc("//example.com/a.png")).toBe("remote");
  });

  it("passes data URLs through", () => {
    expect(classifyImageSrc("data:image/png;base64,AAA")).toBe("data");
  });

  it("detects absolute local paths", () => {
    expect(classifyImageSrc("D:\\pics\\a.png")).toBe("absolute-local");
    expect(classifyImageSrc("D:/pics/a.png")).toBe("absolute-local");
    expect(classifyImageSrc("/home/me/a.png")).toBe("absolute-local");
    expect(classifyImageSrc("file:///D:/pics/a.png")).toBe("absolute-local");
    expect(classifyImageSrc("\\\\server\\share\\a.png")).toBe(
      "absolute-local",
    );
  });

  it("treats the rest as relative", () => {
    expect(classifyImageSrc("./img/a.png")).toBe("relative");
    expect(classifyImageSrc("../img/a.png")).toBe("relative");
    expect(classifyImageSrc("img/a.png")).toBe("relative");
    expect(classifyImageSrc("a.png")).toBe("relative");
  });

  it("trims whitespace and ignores case on schemes", () => {
    expect(classifyImageSrc("  HTTPS://example.com/a.png  ")).toBe("remote");
    expect(classifyImageSrc("  DATA:image/png;base64,AAA ")).toBe("data");
  });

  it("decodes Markdown-escaped absolute paths and Windows separators", () => {
    expect(normalizeImagePath("%22D:%5Cpics%5Ca.png%22")).toBe(
      'D:\\pics\\a.png',
    );
    expect(classifyImageSrc("%22D:%5Cpics%5Ca.png%22")).toBe("absolute-local");
    expect(classifyImageSrc("%22%5C%5Cserver%5Cshare%5Ca.png%22")).toBe(
      "absolute-local",
    );
  });
});
