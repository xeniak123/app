import { getFontEmbedCSS, toPng } from 'html-to-image';
import type { Format } from '../model/types';

/** Selection rings, hints and other editor chrome are marked `data-editor-only` and left out. */
const withoutEditorChrome = (node: HTMLElement) => !(node instanceof HTMLElement && 'editorOnly' in node.dataset);

/**
 * Renders a preview canvas to a PNG at the format's full resolution. The DOM is
 * captured as vector SVG and rasterized straight at the target size, so text
 * stays sharp even though the preview on screen is small.
 */
export async function renderPng(node: HTMLElement, format: Format, fontEmbedCSS?: string): Promise<string> {
  const { width } = node.getBoundingClientRect();
  return toPng(node, {
    width,
    height: (width * format.height) / format.width,
    // An exact canvas size with ratio 1 avoids off-by-one sizes from fractional scaling.
    canvasWidth: format.width,
    canvasHeight: format.height,
    pixelRatio: 1,
    fontEmbedCSS,
    filter: withoutEditorChrome,
  });
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function exportPngs(targets: { format: Format; node: HTMLElement }[], baseName: string) {
  if (targets.length === 0) return;
  // Every canvas shows the same design, so the fonts only need embedding once.
  const fontEmbedCSS = await getFontEmbedCSS(targets[0].node);
  for (const { format, node } of targets) {
    const dataUrl = await renderPng(node, format, fontEmbedCSS);
    downloadDataUrl(dataUrl, `${baseName}-${format.id}-${format.width}x${format.height}.png`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
