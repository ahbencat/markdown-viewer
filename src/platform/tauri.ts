// File-open abstraction: Tauri (dialog + fs plugins) with a browser
// fallback for Linux `npm run dev` where no Rust backend exists.

import type { OpenedDocument } from "../types";

export function isTauri(): boolean {
  return (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  );
}

/** Open a .md file. In Tauri: native dialog + readTextFile.
 * In a plain browser: file input picker. */
export async function openMarkdownFile(): Promise<OpenedDocument | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Markdown",
          extensions: ["md", "markdown", "mdown", "mkd", "mkdn", "mdx", "txt"],
        },
      ],
    });
    if (typeof selected !== "string" || selected === "") return null;
    const markdown = await readTextFile(selected);
    return { path: selected, markdown: stripBom(normalizeNewlines(markdown)) };
  }
  return openViaFileInput();
}

function openViaFileInput(): Promise<OpenedDocument | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.mdown,.mkd,.mkdn,.mdx,.txt,text/markdown";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () =>
        resolve({
          path: file.name,
          markdown: stripBom(
            normalizeNewlines(String(reader.result ?? "")),
          ),
        });
      reader.onerror = () => resolve(null);
      reader.readAsText(file, "utf-8");
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Read a File object (HTML5 drag-drop fallback). */
export function readDroppedFile(file: File): Promise<OpenedDocument> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        path: file.name,
        markdown: stripBom(normalizeNewlines(String(reader.result ?? ""))),
      });
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function stripBom(s: string): string {
  return s.startsWith("﻿") ? s.slice(1) : s;
}
