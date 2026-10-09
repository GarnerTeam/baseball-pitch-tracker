'use client';
import { ExtractedLineup } from '@/lib/lineup-extract-parse';

const MAX_DIMENSION = 1800; // px — plenty to read printed/handwritten names
const JPEG_QUALITY = 0.85;

/**
 * Downscale a user-selected photo/screenshot in the browser and return it as
 * base64 JPEG (no data: prefix). Phone photos are often 4–12 MB; shrinking
 * keeps the upload fast, under the serverless body limit, and cheaper to
 * process, with no meaningful loss for reading text.
 */
export async function prepareImageForUpload(file: File): Promise<{ imageBase64: string; mimeType: 'image/jpeg' }> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.');
  }

  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process that image on this device.');
  // White background so transparent PNG screenshots don't turn black as JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  const imageBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return { imageBase64, mimeType: 'image/jpeg' };
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap honours EXIF orientation with imageOrientation:'from-image'
  // on modern browsers (so sideways iPhone photos arrive upright).
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to <img> */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open that image.')); };
    img.src = url;
  });
}

/** Send a prepared image to the server and get the extracted lineup back. */
export async function extractLineupFromImage(file: File): Promise<ExtractedLineup> {
  const { imageBase64, mimeType } = await prepareImageForUpload(file);
  const res = await fetch('/api/lineup/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, mimeType }),
  });
  let json: Record<string, unknown> = {};
  try { json = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok || json.error) {
    throw new Error(String(json.error ?? `Request failed (${res.status}).`));
  }
  return json as unknown as ExtractedLineup;
}
