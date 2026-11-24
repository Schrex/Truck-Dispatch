import { PAPER_LOG_MAX_BYTES, PAPER_LOG_TYPES } from '../../shared/types';

/** The longest side a photo is sent at: a paper sheet stays readable, and it uploads quickly on a weak signal. */
const LONGEST_SIDE = 2000;
const QUALITY = 0.82;

/**
 * The photo to send: shrunk on the phone to about 2000 px on its longest side
 * and re-encoded as a JPEG, upright as it was taken. A browser that cannot do
 * that sends the original when the Worker would accept it (a JPEG, PNG or
 * WebP of 5 MB or less); otherwise null, and the Driver is told to take it again.
 */
export async function shrinkPhoto(file: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, LONGEST_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const shrunk = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (shrunk && shrunk.size > 0 && shrunk.size <= PAPER_LOG_MAX_BYTES) return shrunk;
  } catch {
    // Falls through to the original below.
  }
  return acceptable(file) ? file : null;
}

function acceptable(file: Blob): boolean {
  return (PAPER_LOG_TYPES as readonly string[]).includes(file.type) && file.size > 0 && file.size <= PAPER_LOG_MAX_BYTES;
}
