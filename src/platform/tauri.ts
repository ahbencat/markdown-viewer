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

/** Image `src` forms, decided without touching the DOM. */
export type ImageSrcKind = "remote" | "data" | "absolute-local" | "relative";

const WINDOWS_ABS_RE = /^[a-zA-Z]:[\\/]/;

/** Decode Markdown's escaped destination and strip surrounding quotes. */
export function normalizeImagePath(src: string): string {
  let decoded = src.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep literal percent signs in otherwise valid local paths.
  }
  return decoded.replace(/^"|"$/g, "");
}

/** Classify an image src so callers know how to resolve it. */
export function classifyImageSrc(src: string): ImageSrcKind {
  const trimmed = src.trim();
  if (/^(https?|ftp):\/\//i.test(trimmed) || trimmed.startsWith("//")) {
    return "remote";
  }
  if (/^data:/i.test(trimmed)) return "data";
  const decoded = normalizeImagePath(trimmed);
  // Markdown-it percent-encodes a leading //, so check for network paths
  // before normalizing backslashes to forward slashes.
  if (decoded.startsWith("\\\\") || decoded.startsWith("%2F%2F")) {
    return "absolute-local";
  }
  if (decoded.startsWith("//")) return "remote";
  const localPath = decoded.replace(/\\/g, "/");
  if (
    localPath.startsWith("/") ||
    localPath.startsWith("file:") ||
    WINDOWS_ABS_RE.test(localPath)
  ) {
    return "absolute-local";
  }
  return "relative";
}

/**
 * Resolve a local image src against the opened document's directory,
 * returning an `asset://` URL WebView2 is allowed to load.
 * Remote (`http…`, `//`) and `data:` URLs pass through untouched.
 * Must run in Tauri; falls back to the raw src in a plain browser
 * (dev `npm run dev` previews remote images, local ones 404 — expected).
 */
export async function resolveLocalImageSrc(
  src: string,
  docPath: string | undefined,
): Promise<string> {
  const kind = classifyImageSrc(src);
  if (kind === "remote" || kind === "data") return src;
  if (!isTauri()) return src;
  const normalized = normalizeImagePath(src);
  const { convertFileSrc, invoke } = await import("@tauri-apps/api/core");
  const path =
    kind === "absolute-local"
      ? toFileUrlPath(normalized)
      : resolveRelativePath(normalized.replace(/\\/g, "/"), docPath);
  if (path === null) return src;
  // Asset scope is independent from fs scope. Absolute images may be on
  // another drive, so grant exactly this file immediately before loading it.
  await invoke("allow_asset_file", { path });
  return convertFileSrc(path);
}

function resolveRelativePath(
  src: string,
  docPath: string | undefined,
): string | null {
  if (docPath === undefined) return null;
  const base = docPath.split(/[/\\]/).slice(0, -1).join("/");
  const joined = [base, ...src.split("/").filter((p) => p !== ".")]
    .join("/")
    .replace(/\\/g, "/");
  // Collapse `a/../` segments textually while staying under the doc dir.
  const parts: string[] = [];
  for (const seg of joined.split("/")) {
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** Normalize an absolute local src to a plain OS path for convertFileSrc. */
function toFileUrlPath(src: string): string {
  const s = normalizeImagePath(src);
  if (s.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(s).pathname).replace(/\//g, "\\");
    } catch {
      return s;
    }
  }
  return s.replace(/\//g, "\\");
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
