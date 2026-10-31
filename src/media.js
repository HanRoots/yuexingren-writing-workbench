const MAX_BYTES = 15 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
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

function dimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      image.onload = null;
      image.onerror = null;
      if (!width || !height) reject(new Error('照片尺寸无效，请选择其他图片。'));
      else if (width * height > MAX_PIXELS) reject(new Error('单张照片不能超过 4000 万像素，请先缩小图片尺寸再上传。'));
      else resolve({width, height});
    };
    image.onerror = () => {
      image.onload = null;
      image.onerror = null;
      reject(new Error('这张照片无法解码，请重新保存为 JPG、PNG 或 WebP 后上传。'));
    };
    image.src = dataUrl;
  });
}

/** Validate and retain the original photo bytes; no resizing or recompression. */
export async function readImageFile(file) {
  if (!file || typeof file.slice !== 'function' || typeof file.size !== 'number') {
    throw new Error('请选择一张 JPG、PNG 或 WebP 照片。');
  }
  const mime = String(file.type || '').toLowerCase();
  if (!FORMATS.has(mime)) throw new Error('仅支持 JPG、PNG 和 WebP 图片，请先转换其他格式。');
  if (!file.size) throw new Error('这张照片是空文件，请重新选择。');
  if (file.size > MAX_BYTES) throw new Error('单张照片不能超过 15 MB，请先减小文件大小再上传。');
  const header = await readFile(file.slice(0, 16), false);
  if (detectedFormat(header) !== mime) throw new Error('文件内容与图片格式不符，请重新保存为 JPG、PNG 或 WebP 后上传。');
  const dataUrl = await readFile(file, true);
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(`data:${mime};base64,`)) {
    throw new Error('照片读取失败，请重新选择文件。');
  }
  const size = await dimensions(dataUrl);
  const id = globalThis.crypto?.randomUUID?.() ?? `page-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {id, name: typeof file.name === 'string' ? file.name : '手写原稿', dataUrl, ...size};
}
