// Ported from md-preview/Rendering/MarkdownHTML+KaTeX.swift
// (katexRenderMathBody + the renderMath() contract).
//
// KaTeX math bootstrap: `<div class="math math-display">` /
// `<span class="math math-inline">` nodes carry raw latex as text; the
// wiring script calls katex.render(tex, el, {...}) per node.
// In the MVP the vendor script is loaded lazily from public/vendor/katex.

export const katexFallbackScript = `<script>
window.addEventListener('load', () => {
    document.querySelectorAll('.math').forEach((node) => {
        node.classList.add('math-error');
        node.textContent = "KaTeX renderer is unavailable.\\n\\n" + node.textContent;
    });
});
</script>`;

/** Body of `function renderMath()`. Mirrors katexRenderMathBody:
 * stash source on `__mdSrc`, render with katex, mark done, fire event. */
export const katexRenderMathBody = `function renderMath() {
    document.querySelectorAll('.math').forEach((el) => {
        if (el.dataset.mathDone === '1') return;
        const tex = el.textContent;
        const display = el.classList.contains('math-display');
        // Pre-render source, stashed so updates can pair
        // unchanged math with its finished output during DOM diffs.
        el.__mdSrc = tex;
        try {
            katex.render(tex, el, {
                displayMode: display,
                throwOnError: false,
                output: 'htmlAndMathml'
            });
            el.dataset.mathDone = '1';
        } catch (err) {
            el.classList.add('math-error');
            el.textContent = String((err && err.message) || err);
            el.dataset.mathDone = '1';
        }
    });
    window.dispatchEvent(new Event('md-preview-math-rendered'));
}`;
