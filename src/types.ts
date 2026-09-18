// Shared MVP types.

export interface OpenedDocument {
  /** Display path (Tauri fs path or mock file name). */
  path: string;
  /** Raw markdown source. */
  markdown: string;
}
