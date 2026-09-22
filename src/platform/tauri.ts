// File-open abstraction: Tauri (dialog + fs plugins) with a browser
// fallback for Linux `npm run dev` where no Rust backend exists.

import { invoke } from "@tauri-apps/api/core";
import type { OpenedDocument } from "../types";

export function isTauri(): boolean {
  return (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  );
}

/** Extensions treated as Markdown throughout open dialog, drop and picker. */
export const MARKDOWN_EXTENSIONS = [
  "md",
  "markdown",
  "mdown",
  "mkd",
  "mkdn",
  "mdx",
  "txt",
];

/** True when the path (or file name) ends with a Markdown extension. */
export function isMarkdownPath(path: string): boolean {
  const base = path.split(/[/\\]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot === -1) return false;
  return MARKDOWN_EXTENSIONS.includes(base.slice(dot + 1).toLowerCase());
}

/** Return the Markdown path passed by Windows when the app was launched by association. */
export async function getLaunchFile(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("get_launch_file");
}

export async function openMarkdownFile(): Promise<OpenedDocument | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Markdown",
          extensions: [...MARKDOWN_EXTENSIONS],
        },
      ],
    });
    if (typeof selected !== "string" || selected === "") return null;
    return readPathFile(selected);
  }
  return openViaFileInput();
}

/** Read a filesystem path via the Tauri fs plugin (dialog, native drop). */
export async function readPathFile(path: string): Promise<OpenedDocument> {
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  const markdown = await readTextFile(path);
  return { path, markdown: stripBom(normalizeNewlines(markdown)) };
}

export type NativeDropEvent =
  | { type: "enter"; paths: string[] }
  | { type: "over" }
  | { type: "drop"; paths: string[] }
  | { type: "leave" };

/** Subscribe to native OS file drops (Tauri only). Resolves to unlisten. */
export async function onNativeDrop(
  handler: (event: NativeDropEvent) => void,
): Promise<() => void> {
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload as
      | { type: "enter"; paths: string[] }
      | { type: "over" }
      | { type: "drop"; paths: string[] }
      | { type: "leave" };
    switch (payload.type) {
      case "enter":
        handler({ type: "enter", paths: payload.paths });
        break;
      case "over":
        handler({ type: "over" });
        break;
      case "drop":
        handler({ type: "drop", paths: payload.paths });
        break;
      case "leave":
        handler({ type: "leave" });
        break;
    }
  });
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
