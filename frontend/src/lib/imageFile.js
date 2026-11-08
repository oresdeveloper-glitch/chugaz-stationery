// Phone cameras produce 4-12 MB photos. Serverless hosting rejects request
// bodies over 4.5 MB before our route even runs, so a picture taken with the
// phone used to look like "nothing happened". Shrink and re-encode the photo in
// the browser first; the server then receives a normal-size JPEG.
const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_TARGET_BYTES = 1.4 * 1024 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function prepareImageFile(file, opts = {}) {
  if (!file || !file.type || !file.type.startsWith('image/')) return file;
  // A canvas would drop every frame but the first, so leave animations alone.
  if (file.type === 'image/gif') return file;

  const maxDim = Number(opts.maxDimension) || DEFAULT_MAX_DIMENSION;
  const target = Number(opts.targetBytes) || DEFAULT_TARGET_BYTES;

  try {
    const img = await loadImage(file);
    const longest = Math.max(img.naturalWidth || 0, img.naturalHeight || 0);
    if (!longest) return file;
    let scale = Math.min(1, maxDim / longest);
    // Already small and inside the size limit: keep the original bytes (and
    // any PNG transparency) instead of re-encoding.
    if (scale === 1 && file.size <= target) return file;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    let quality = 0.85;
    let blob = null;
    for (let attempt = 0; attempt < 7; attempt++) {
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // JPEG has no alpha channel; fill white so transparent areas of a PNG
      // do not turn black.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      if (blob && blob.size <= target) break;
      if (quality > 0.5) quality -= 0.12;
      else scale *= 0.82;
    }
    if (!blob) return file;

    const base = String(file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch (_) {
    // Unsupported format (for example HEIC on a browser that cannot decode it):
    // send the original and let the server answer with its own message.
    return file;
  }
}

export async function prepareImageFiles(files) {
  const list = Array.from(files || []);
  const out = [];
  for (const file of list) out.push(await prepareImageFile(file));
  return out;
}
