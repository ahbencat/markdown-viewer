// Ported from md-preview/Rendering/MarkdownHTML+Mermaid.swift
// (renderMermaidBlocks + the mermaidInitWiring IIFE contract).
//
// Mermaid diagram rendering: post-process `<pre><code class="language-mermaid">`
// into `<figure class="mermaid-figure">` + HUD controls. Runtime rendering is
// done by vendor mermaid.min.js via the wiring script (mermaidInitWiring),
// which this module re-emits verbatim.

export interface MermaidRenderResult {
  html: string;
  containsMermaid: boolean;
}

const mermaidFenceRe =
  /<pre\b([^>]*)>\s*<code\b[^>]*class="[^"]*\blanguage-mermaid\b[^"]*"[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/g;

const STRINGS = {
  diagramLabel: "Mermaid diagram",
  zoomOut: "Zoom Out",
  resetZoom: "Reset zoom",
  zoomIn: "Zoom In",
  fillWidth: "Fill width",
  fitDiagram: "Fit diagram",
  openWindow: "Open in Window",
  rendererUnavailable: "Mermaid renderer is unavailable.\n\n",
} as const;

function jsStringLiteral(s: string): string {
  return JSON.stringify(s);
}

function escapeHtml(s: string): string {
  let out = "";
  for (const ch of s) {
    switch (ch) {
      case "&":
        out += "&amp;";
        break;
      case "<":
        out += "&lt;";
        break;
      case ">":
        out += "&gt;";
        break;
      case '"':
        out += "&quot;";
        break;
      default:
        out += ch;
    }
  }
  return out;
}

export function renderMermaidBlocks(
  html: string,
  opts: { popupButton?: boolean } = {},
): MermaidRenderResult {
  if (!html.includes("language-mermaid")) {
    return { html, containsMermaid: false };
  }
  let found = false;
  // The popup button needs a host handler (MdPreview.mermaidPopup in the
  // macOS app). Tauri MVP has no popup window yet, so default it off.
  const popupButton = opts.popupButton
    ? `<button type="button" class="mermaid-hud-btn mermaid-hud-popup" data-mm-act="popup" tabindex="-1" aria-label="${escapeHtml(STRINGS.openWindow)}" title="${escapeHtml(STRINGS.openWindow)}">⛶</button>`
    : "";
  const rendered = html.replace(
    mermaidFenceRe,
    (_full, sourceAttributes: string, diagram: string) => {
      found = true;
      return `<figure${sourceAttributes} class="mermaid-figure" tabindex="0" role="img" aria-label="${escapeHtml(STRINGS.diagramLabel)}">
<div class="mermaid-stage"><div class="mermaid">
${diagram}
</div></div>
<div class="mermaid-hud" aria-hidden="true">
<div class="mermaid-hud-group mermaid-hud-zoom">
<button type="button" class="mermaid-hud-btn" data-mm-act="out" tabindex="-1" aria-label="${escapeHtml(STRINGS.zoomOut)}">−</button>
<button type="button" class="mermaid-hud-btn mermaid-hud-level" data-mm-act="reset" tabindex="-1" aria-label="${escapeHtml(STRINGS.resetZoom)}">100%</button>
<button type="button" class="mermaid-hud-btn" data-mm-act="in" tabindex="-1" aria-label="${escapeHtml(STRINGS.zoomIn)}">+</button>
</div>
<div class="mermaid-hud-group mermaid-hud-actions">
<button type="button" class="mermaid-hud-btn mermaid-hud-width" data-mm-act="width" tabindex="-1" aria-label="${escapeHtml(STRINGS.fillWidth)}" aria-pressed="false" title="${escapeHtml(STRINGS.fillWidth)}"><span class="mermaid-hud-width-symbol" aria-hidden="true">⤢</span></button>
${popupButton}
</div>
</div>
</figure>`;
    },
  );
  return { html: rendered, containsMermaid: found };
}

/** Fallback shown when the mermaid vendor script failed to load. */
export const mermaidFallbackScript = `<script>
window.addEventListener('load', () => {
    document.querySelectorAll('.mermaid').forEach((node) => {
        node.classList.add('mermaid-error');
        node.textContent = ${jsStringLiteral(STRINGS.rendererUnavailable)} + node.textContent;
    });
});
</script>`;

/** Mermaid wiring IIFE. Contract mirrors mermaidInitWiring:
 * - queue + drain() for viewport-driven rendering
 * - renderAll(theme?) forces every remaining figure (used before print)
 * - themeOverride pins the theme for print (light) then restores
 * - `md-preview-mermaid-rendered` event when the queue settles
 * - pan/zoom HUD via data-mm-act buttons
 * Font stack uses Segoe UI (Windows) instead of -apple-system. */
export const mermaidInitWiring = `(() => {
        const fillWidthLabel = ${jsStringLiteral(STRINGS.fillWidth)};
        const fitDiagramLabel = ${jsStringLiteral(STRINGS.fitDiagram)};
        const states = new WeakMap();
        const queue = [];
        let drainPromise = null;
        let initializedTheme = null;
        let themeOverride = null;

        function selectedTheme() {
            const nativeScheme = document.documentElement.dataset.mdpColorScheme;
            if (nativeScheme) return nativeScheme === 'dark' ? 'dark' : 'default';
            const dark = window.matchMedia
                && window.matchMedia('(prefers-color-scheme: dark)').matches;
            return dark ? 'dark' : 'default';
        }

        function activeTheme() {
            return themeOverride || selectedTheme();
        }

        function ensureInit(theme) {
            if (initializedTheme === theme) return;
            initializedTheme = theme;
            mermaid.initialize({
                startOnLoad: false,
                theme,
                securityLevel: 'strict',
                fontFamily: '"Segoe UI", system-ui, sans-serif'
            });
        }

        function drain() {
            if (drainPromise) return drainPromise;
            drainPromise = (async () => {
                while (queue.length) {
                    const figure = queue.shift();
                    try {
                        await renderOne(figure);
                    } catch (err) {
                        figure.classList.add('mermaid-error');
                    }
                }
            })().then(() => {
                drainPromise = null;
                if (queue.length) return drain();
                window.dispatchEvent(new Event('md-preview-mermaid-rendered'));
            });
            return drainPromise;
        }

        async function renderAll(theme) {
            themeOverride = theme || null;
            const want = activeTheme();
            document.querySelectorAll('.mermaid-figure').forEach((figure) => {
                const node = figure.querySelector('.mermaid');
                if (!node || queue.includes(figure)) return;
                if (node.dataset.mmDone !== '1' || node.dataset.mmTheme !== want) {
                    queue.push(figure);
                }
            });
            while (queue.length || drainPromise) {
                await drain();
            }
        }

        async function renderOne(figure) {
            const theme = activeTheme();
            ensureInit(theme);
            const node = figure.querySelector('.mermaid');
            if (!node) return;
            if (node.dataset.mmDone === '1') {
                if (node.dataset.mmTheme === theme) return;
                if (typeof node.__mdSrc !== 'string') return;
                const prior = states.get(figure);
                if (prior && prior.surface) prior.surface.style.transform = '';
                node.textContent = node.__mdSrc;
                node.removeAttribute('data-processed');
                delete node.dataset.mmDone;
            } else {
                node.__mdSrc = node.textContent;
            }
            try {
                await mermaid.run({ nodes: [node], suppressErrors: true });
            } catch (err) {
                figure.classList.add('mermaid-error');
                return;
            }
            const svg = node.querySelector('svg');
            if (!svg) {
                figure.classList.add('mermaid-error');
                return;
            }
            node.dataset.mmDone = '1';
            node.dataset.mmTheme = theme;
            attachZoom(figure, svg);
        }

        function attachZoom(figure, svg) {
            let vbW, vbH;
            const vb = svg.viewBox && svg.viewBox.baseVal;
            if (vb && vb.width && vb.height) {
                vbW = vb.width; vbH = vb.height;
            } else {
                vbW = parseFloat(svg.getAttribute('width')) || (svg.getBBox ? svg.getBBox().width : 0) || 1;
                vbH = parseFloat(svg.getAttribute('height')) || (svg.getBBox ? svg.getBBox().height : 0) || 1;
                svg.setAttribute('viewBox', '0 0 ' + vbW + ' ' + vbH);
            }
            svg.removeAttribute('width');
            svg.removeAttribute('height');
            svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            svg.style.width = '100%';
            svg.style.height = '100%';
            const surface = svg.parentElement || svg;
            surface.style.transformOrigin = '0 0';

            if (vbW > 0 && vbH > 0) {
                figure.style.setProperty('--mm-aspect', vbW + ' / ' + vbH);
            }

            const alreadyWired = states.has(figure);
            const state = {
                tx: 0, ty: 0, scale: 1, min: 1, max: 8,
                rect: null, raf: 0, dragging: false,
                lastX: 0, lastY: 0, surface,
                vbW, vbH, svg
            };
            states.set(figure, state);
            if (!alreadyWired) {
                wireHud(figure, state);
                wireViewport(figure);
                wirePan(figure, state);
            }
        }

        function applyTransform(state) {
            state.surface.style.transform =
                'translate(' + state.tx + 'px,' + state.ty + 'px) scale(' + state.scale + ')';
        }

        function zoomAt(figure, state, factor, cx, cy) {
            const next = Math.min(state.max, Math.max(state.min, state.scale * factor));
            if (next === state.scale) return;
            const rect = state.surface.getBoundingClientRect();
            const px = (cx === undefined ? rect.left + rect.width / 2 : cx) - rect.left;
            const py = (cy === undefined ? rect.top + rect.height / 2 : cy) - rect.top;
            state.tx = px - (px - state.tx) * (next / state.scale);
            state.ty = py - (py - state.ty) * (next / state.scale);
            state.scale = next;
            applyTransform(state);
            updateLevel(figure, state);
        }

        function updateLevel(figure, state) {
            const level = figure.querySelector('[data-mm-act="reset"]');
            if (level) level.textContent = Math.round(state.scale * 100) + '%';
        }

        function wireHud(figure, state) {
            figure.addEventListener('click', (ev) => {
                const btn = ev.target.closest('[data-mm-act]');
                if (!btn) return;
                const act = btn.getAttribute('data-mm-act');
                if (act === 'in') zoomAt(figure, state, 1.25);
                else if (act === 'out') zoomAt(figure, state, 0.8);
                else if (act === 'reset') {
                    state.tx = 0; state.ty = 0; state.scale = 1;
                    applyTransform(state);
                    updateLevel(figure, state);
                } else if (act === 'width') {
                    const on = figure.classList.toggle('mermaid-fill-width');
                    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                    btn.title = on ? fitDiagramLabel : fillWidthLabel;
                }
            });
        }

        function wireViewport(figure) {
            if (!('IntersectionObserver' in window)) {
                queue.push(figure);
                drain();
                return;
            }
            const io = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        io.disconnect();
                        if (!queue.includes(figure)) queue.push(figure);
                        drain();
                    }
                }
            }, { rootMargin: '400px' });
            io.observe(figure);
        }

        function wirePan(figure, state) {
            const stage = figure.querySelector('.mermaid-stage');
            if (!stage) return;
            stage.addEventListener('pointerdown', (ev) => {
                if (state.scale <= 1) return;
                state.dragging = true;
                state.lastX = ev.clientX; state.lastY = ev.clientY;
                stage.setPointerCapture(ev.pointerId);
            });
            stage.addEventListener('pointermove', (ev) => {
                if (!state.dragging) return;
                state.tx += ev.clientX - state.lastX;
                state.ty += ev.clientY - state.lastY;
                state.lastX = ev.clientX; state.lastY = ev.clientY;
                applyTransform(state);
            });
            const end = () => { state.dragging = false; };
            stage.addEventListener('pointerup', end);
            stage.addEventListener('pointercancel', end);
        }

        document.querySelectorAll('.mermaid-figure').forEach((figure) => {
            wireViewport(figure);
            figure.addEventListener('dblclick', () => {
                const state = states.get(figure);
                if (!state) return;
                state.tx = 0; state.ty = 0; state.scale = 1;
                applyTransform(state);
                updateLevel(figure, state);
            });
        });

        window.MdPreviewMermaid = { renderAll, drain };
})();`;
