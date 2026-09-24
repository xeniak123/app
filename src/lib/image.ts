/**
 * Reads an uploaded image and scales it down so projects stay small enough to
 * save in the browser. Transparent formats (logos) stay PNG, photos become JPEG.
 */
export async function readImage(file: File, maxSide = 1600): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('To nie jest plik graficzny.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const naturalW = img.naturalWidth || 1024;
    const naturalH = img.naturalHeight || 1024;
    const scale = Math.min(1, maxSide / Math.max(naturalW, naturalH));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(naturalW * scale);
    canvas.height = Math.round(naturalH * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Nie udało się przetworzyć obrazu.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const transparent = file.type === 'image/png' || file.type === 'image/svg+xml' || file.type === 'image/webp';
    return transparent ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}
