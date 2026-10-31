const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const ORIGINAL_BYTES_LIMIT = 15 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_SIDE = 4096;
const MAX_RESIZE_RETRIES = 3;
const FORMATS = new Set(['image/jpeg', 'image/png', 'image/webp']);

function readFile(blob, asDataUrl) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('无法读取这张照片，请重新选择文件。'));
    reader.onabort = () => reject(new Error('照片读取已取消，请重新选择文件。'));
    try {
      if (asDataUrl) reader.readAsDataURL(blob);
      else reader.readAsArrayBuffer(blob);
    } catch {
      reject(new Error('无法读取这张照片，请重新选择文件。'));
    }
  });
}

function detectedFormat(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, i) => bytes[i] === value)) return 'image/png';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return '';
}

function loadImage(image, objectUrl) {
  return new Promise((resolve, reject) => {
    image.decoding = 'async';
    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
        reject(new Error('照片尺寸无效，请选择其他图片。'));
      } else resolve({width, height});
    };
    image.onerror = () => reject(new Error('这张照片无法解码，请重新保存为 JPG、PNG 或 WebP 后上传。'));
    image.src = objectUrl;
  });
}

function encodeJpeg(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(blob => {
        if (!blob || !blob.size || blob.type !== 'image/jpeg') {
          reject(new Error('浏览器未能优化这张照片，请先缩小图片，或改用电脑浏览器上传。'));
        } else resolve(blob);
      }, 'image/jpeg', 0.95);
    } catch {
      reject(new Error('照片优化失败，请先缩小图片，或改用电脑浏览器上传。'));
    }
  });
}

function validDataUrl(value, mime) {
  const prefix = `data:${mime};base64,`;
  return typeof value === 'string' && value.startsWith(prefix) && value.length > prefix.length;
}

/** Keep normal originals; automatically downsize large photos without cropping. */
export async function readImageFile(file) {
  if (!file || typeof file.slice !== 'function' || typeof file.size !== 'number') {
    throw new Error('请选择一张 JPG、PNG 或 WebP 照片。');
  }
  const mime = String(file.type || '').toLowerCase();
  if (!FORMATS.has(mime)) throw new Error('仅支持 JPG、PNG 和 WebP 图片，请先转换其他格式。');
  if (!file.size) throw new Error('这张照片是空文件，请重新选择。');
  if (file.size > MAX_INPUT_BYTES) throw new Error('单张照片不能超过 100 MB，请先减小文件大小再上传。');
  const header = await readFile(file.slice(0, 16), false);
  if (detectedFormat(header) !== mime) throw new Error('文件内容与图片格式不符，请重新保存为 JPG、PNG 或 WebP 后上传。');

  let objectUrl;
  let image;
  let canvas;
  try {
    try {
      objectUrl = URL.createObjectURL(file);
      image = new Image();
    } catch {
      throw new Error('浏览器无法读取这张照片，请重新选择文件，或改用电脑浏览器上传。');
    }
    // Image decoding applies EXIF orientation in modern browsers. Drawing it
    // directly avoids rotating an already oriented photo for a second time.
    const original = await loadImage(image, objectUrl);
    const optimized = Math.max(original.width, original.height) > MAX_SIDE || file.size > ORIGINAL_BYTES_LIMIT;
    let width = original.width;
    let height = original.height;
    let blob = file;
    let outputMime = mime;
    if (optimized) {
      const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      canvas = document.createElement('canvas');
      for (let attempt = 0; attempt <= MAX_RESIZE_RETRIES; attempt += 1) {
        canvas.width = width;
        canvas.height = height;
        let ctx;
        try { ctx = canvas.getContext('2d', {alpha: false}); }
        catch { throw new Error('浏览器无法处理这张照片，请先缩小图片，或改用电脑浏览器上传。'); }
        if (!ctx) throw new Error('浏览器无法处理这张照片，请先缩小图片，或改用电脑浏览器上传。');
        try {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(image, 0, 0, width, height);
        } catch {
          throw new Error('浏览器无法缩小这张照片，请先减小图片尺寸，或改用电脑浏览器上传。');
        }
        blob = await encodeJpeg(canvas);
        if (blob.size <= MAX_OUTPUT_BYTES) break;
        if (attempt === MAX_RESIZE_RETRIES) {
          throw new Error('这张照片优化后仍超过 8 MB，请先减小图片尺寸后重新上传。');
        }
        const nextScale = Math.sqrt(MAX_OUTPUT_BYTES / blob.size) * 0.9;
        width = Math.max(1, Math.floor(width * nextScale));
        height = Math.max(1, Math.floor(height * nextScale));
      }
      outputMime = 'image/jpeg';
    }
    // Before decoding, only a small signature is read. Large originals never
    // become Base64: only the final, bounded JPEG becomes a persistent data URL.
    const dataUrl = await readFile(blob, true);
    if (!validDataUrl(dataUrl, outputMime)) throw new Error('照片读取失败，请重新选择文件。');
    const id = globalThis.crypto?.randomUUID?.() ?? `page-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return {id, name: typeof file.name === 'string' ? file.name : '手写原稿', dataUrl, width, height, optimized};
  } finally {
    if (image) {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute?.('src');
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
