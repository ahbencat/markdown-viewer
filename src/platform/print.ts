// Export-to-PDF via window.print() + print CSS (MVP route).
//
// Flow: renderAllMermaid('default') → add print class → window.print() →
// restore theme. On Windows/WebView2 this opens the system print dialog
// where the user picks "Save as PDF".

export async function exportPdf(): Promise<void> {
  // Force every mermaid figure to render in the light theme before the
  // page is captured; otherwise the PDF keeps raw mermaid source or
  // dark-theme SVGs.
  const { renderAllMermaid } = await import("./vendor");
  try {
    await renderAllMermaid("default");
  } catch {
    // Print anyway with whatever rendered.
  }
  const mermaid = (
    window as unknown as {
      MdPreviewMermaid?: { renderAll: (theme?: string) => Promise<void> };
    }
  ).MdPreviewMermaid;
  document.documentElement.classList.add("mdp-printing");
  try {
    window.print();
  } finally {
    // Restore async: the print dialog is modal, so removal happens after
    // the user dismisses it; re-render on-screen theme lazily.
    setTimeout(() => {
      document.documentElement.classList.remove("mdp-printing");
      void mermaid?.renderAll();
    }, 500);
  }
}
