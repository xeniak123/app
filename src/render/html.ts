import { FORMATS } from '../model/formats';
import { layoutTiles } from '../model/layout';
import { STYLES } from '../model/themes';
import type { Design, Format } from '../model/types';
import { fitText } from './fit';
import { fontFaceCss } from './fonts';
import { tileRender } from './tile';

/**
 * Standalone HTML for a design: one file with inlined fonts, images and a tiny
 * script that fits the text, so it renders the same in any browser, in a
 * headless screenshot, or pasted into a website.
 */

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

const BASE_CSS = `*{box-sizing:border-box}
html,body{margin:0;padding:0}
.canvas{position:relative;overflow:hidden;flex:none}
.tile{position:absolute;overflow:hidden;background-size:cover;background-position:center}
.tile__box{position:absolute;display:flex;flex-direction:column}
.tile__text{flex:none;white-space:pre-line;overflow-wrap:normal;word-break:normal;hyphens:manual}
.tile--headline .tile__text,.tile--number .tile__text,.tile--cta .tile__text,.tile--brand .tile__text{text-wrap:balance}
.tile--text .tile__text,.tile--info .tile__text{text-wrap:pretty}
.tile__logo{position:absolute;background-size:contain;background-repeat:no-repeat;background-position:left center}
.animate .tile{animation:tile-in .7s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i) * 90ms)}
.animate .tile__text{animation:text-in .8s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i) * 90ms + 200ms)}
@keyframes tile-in{from{opacity:0;transform:translateY(10%) scale(.92)}}
@keyframes text-in{from{opacity:0;transform:translateY(35%)}}
@media (prefers-reduced-motion:reduce){.animate .tile,.animate .tile__text{animation:none}}`;

// Fits every text box once fonts are ready, then optionally starts the entrance
// animation and scales the page to the window. Marks <html data-ready> when done.
const SCRIPT = `(function(){
var fit=${fitText.toString()};
function run(){
  var els=document.querySelectorAll('[data-fit]');
  for(var i=0;i<els.length;i++){var el=els[i];fit(el,+el.getAttribute('data-w'),+el.getAttribute('data-h'),+el.getAttribute('data-fit'));}
  var body=document.body;
  if(body.hasAttribute('data-animate')){var c=document.querySelectorAll('.canvas');for(var j=0;j<c.length;j++)c[j].classList.add('animate');}
  if(body.hasAttribute('data-fit-window')){
    var page=document.querySelector('.page');
    var scale=function(){var s=Math.min(1,innerWidth/page.offsetWidth,innerHeight/page.offsetHeight);page.style.transform='scale('+s+')';};
    scale();addEventListener('resize',scale);
  }
  document.documentElement.setAttribute('data-ready','1');
}
if(document.fonts&&document.fonts.ready){document.fonts.ready.then(run);}else{run();}
})();`;

export function canvasHtml(design: Design, format: Format, width: number, height: number): string {
  const style = STYLES[design.style];
  const rects = layoutTiles(design.tiles, {
    width: format.width,
    height: format.height,
    padding: style.padding,
    gap: style.gap,
    seed: design.seed,
  });
  const tiles = design.tiles.map((tile, index) => {
    const rect = rects[tile.id];
    if (!rect) return '';
    const view = tileRender(tile, rect, width, height, design);
    const tileCss = [
      `left:${px(rect.x * width)}`,
      `top:${px(rect.y * height)}`,
      `width:${px(rect.w * width)}`,
      `height:${px(rect.h * height)}`,
      `background-color:${view.paint.background}`,
      view.backgroundImage && `background-image:${view.backgroundImage}`,
      `color:${view.paint.color}`,
      `border-radius:${px(view.radius)}`,
      view.boxShadow && `box-shadow:${view.boxShadow}`,
      `--i:${index}`,
    ]
      .filter(Boolean)
      .join(';');
    const { font } = view;
    const textCss = [
      `font-family:${font.family}`,
      `font-weight:${font.weight}`,
      `text-align:${font.align}`,
      `text-transform:${font.transform}`,
      `letter-spacing:${font.letterSpacing}`,
      `line-height:${font.lineHeight}`,
    ].join(';');
    const logo = view.logo
      ? `<div class="tile__logo" style="${escapeHtml(`inset:${px(view.pad)};background-image:url("${view.logo}")`)}"></div>`
      : '';
    const text = view.text
      ? `<div class="tile__box" style="${escapeHtml(`inset:${px(view.pad)};justify-content:${font.justify}`)}">` +
        `<div class="tile__text" data-fit="${view.maxFontPx}" data-w="${view.boxW}" data-h="${view.boxH}" style="${escapeHtml(textCss)}">${escapeHtml(view.text)}</div></div>`
      : '';
    return `<div class="tile tile--${tile.kind}" data-tile="${escapeHtml(tile.id)}" style="${escapeHtml(tileCss)}">${logo}${text}</div>`;
  });
  return `<div class="canvas" data-format="${format.id}" style="width:${px(width)};height:${px(height)};background:${design.palette.bg}">${tiles.join('')}</div>`;
}

function page(title: string, bodyAttrs: string, css: string, content: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="Tilecast">
<title>${escapeHtml(title)}</title>
<style>
${css}
</style>
</head>
<body${bodyAttrs}>
${content}
<script>${SCRIPT}</script>
</body>
</html>
`;
}

export function designTitle(design: Design): string {
  return design.tiles.find((t) => t.kind === 'headline')?.text.replace(/\s+/g, ' ') || 'Tilecast';
}

export interface FormatDocumentOptions {
  /** Play the tiles' entrance animation on load. */
  animate?: boolean;
  /** Scale the design down to fit the browser window (for viewing, not for screenshots). */
  fitWindow?: boolean;
}

/** A page holding exactly one format at its export size, e.g. 1080×1080 CSS pixels. */
export function formatDocument(design: Design, format: Format, options: FormatDocumentOptions = {}): string {
  const attrs = [options.animate && ' data-animate', options.fitWindow && ' data-fit-window'].filter(Boolean).join('');
  const css = `${fontFaceCss(design.style)}
${BASE_CSS}
body{background:${design.palette.bg}}
.page{width:${format.width}px;height:${format.height}px;transform-origin:0 0}`;
  return page(
    `${designTitle(design)} – ${format.label}`,
    attrs,
    css,
    `<div class="page">${canvasHtml(design, format, format.width, format.height)}</div>`,
  );
}

export interface SheetDocument {
  html: string;
  width: number;
  height: number;
}

/** All formats side by side at a common height: one image to review the whole design. */
export function sheetDocument(design: Design, height = 440, formats: Format[] = FORMATS): SheetDocument {
  const pad = 36;
  const gap = 36;
  const label = 40;
  const cards = formats.map((format) => {
    const width = Math.round((height * format.width) / format.height);
    return { format, width };
  });
  const totalWidth = pad * 2 + cards.reduce((sum, c) => sum + c.width, 0) + gap * (cards.length - 1);
  const totalHeight = pad * 2 + label + height;
  const content = cards
    .map(
      ({ format, width }) =>
        `<div class="card"><div class="label"><b>${escapeHtml(format.label)}</b> ${format.width}×${format.height}</div>${canvasHtml(design, format, width, height)}</div>`,
    )
    .join('');
  const css = `${fontFaceCss(design.style)}
${BASE_CSS}
body{background:#f1efea;width:${totalWidth}px;height:${totalHeight}px;overflow:hidden}
.sheet{display:flex;gap:${gap}px;padding:${pad}px;align-items:flex-end}
.card{display:flex;flex-direction:column;gap:12px}
.label{height:${label - 12}px;display:flex;align-items:flex-end;gap:8px;font:400 17px/1 system-ui,sans-serif;color:#6d6962}
.label b{font-weight:700;color:#1c1b19}
.canvas{box-shadow:0 1px 2px rgba(20,16,10,.08),0 10px 30px rgba(20,16,10,.10)}`;
  return {
    html: page(designTitle(design), '', css, `<div class="sheet">${content}</div>`),
    width: totalWidth,
    height: totalHeight,
  };
}
