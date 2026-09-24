import type { Browser } from './browser';

export interface SheetItem {
  label: string;
  image: Buffer;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const SHEET_PAD = 24;
export const SHEET_GAP = 20;

/** Lays images out side by side at one height (wrapping into rows) and captures them as one image. */
export async function contactSheet(
  browser: Browser,
  items: SheetItem[],
  options: { rowHeight: number; maxWidth: number; type?: 'png' | 'jpeg' },
): Promise<Buffer> {
  const { rowHeight, maxWidth } = options;
  const pad = SHEET_PAD;
  const gap = SHEET_GAP;
  const widths = items.map((item) => Math.round((rowHeight * item.width) / item.height));
  const pageWidth = Math.min(maxWidth, pad * 2 + widths.reduce((sum, w) => sum + w, 0) + gap * (items.length - 1));
  const cards = items
    .map(
      (item, i) =>
        `<figure style="width:${widths[i]}px"><figcaption>${escapeHtml(item.label)}</figcaption><img width="${widths[i]}" height="${rowHeight}" src="data:${item.mime};base64,${item.image.toString('base64')}"></figure>`,
    )
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0;background:#e7e5e1;font:600 14px/1.2 system-ui,-apple-system,sans-serif;color:#44403c}
    main{display:flex;flex-wrap:wrap;gap:${gap}px;padding:${pad}px;width:${pageWidth}px;align-items:flex-end}
    figure{margin:0;display:flex;flex-direction:column;gap:8px}
    figcaption{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    img{display:block;box-shadow:0 1px 2px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.10);max-width:${pageWidth - pad * 2}px;height:auto;aspect-ratio:auto}
  </style></head><body><main>${cards}</main></body></html>`;

  const page = await browser.newPage({ width: pageWidth, height: 100, scale: 1 });
  try {
    const { frameTree } = await page.send<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree');
    await page.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
    await page.evaluate('Promise.all([...document.images].map((img) => img.decode().catch(() => null)))');
    const height = await page.evaluate<number>('Math.ceil(document.querySelector("main").getBoundingClientRect().height)');
    await page.setViewport({ width: pageWidth, height, scale: 1 });
    return await page.screenshot({
      format: options.type ?? 'png',
      quality: options.type === 'jpeg' ? 88 : undefined,
      clip: { x: 0, y: 0, width: pageWidth, height, scale: 1 },
    });
  } finally {
    await page.close();
  }
}
