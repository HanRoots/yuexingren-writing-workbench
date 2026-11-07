// Store already-compressed PNG/JPG files in a standards-compatible UTF-8 ZIP.
// Using Blob parts keeps the archive from duplicating every image in JS memory.
const CRC_TABLE = Uint32Array.from({length: 256}, (_, value) => {
  for (let i = 0; i < 8; i += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export async function crc32(blob) {
  let crc = 0xffffffff;
  if (typeof blob.stream === 'function') {
    const reader = blob.stream().getReader();
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        for (const byte of value) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
      }
    } finally { reader.releaseLock(); }
  } else {
    for (const byte of new Uint8Array(await blob.arrayBuffer())) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function binary(size) {
  const bytes = new Uint8Array(size);
  return {bytes, view: new DataView(bytes.buffer)};
}

export async function createImageZip(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 65535) throw new Error('没有可打包的图片，或图片数量过多。');
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  let centralSize = 0;
  for (const entry of entries) {
    if (!entry || !(entry.blob instanceof Blob) || !entry.blob.size
        || typeof entry.name !== 'string' || !entry.name || /[\\/\u0000]/.test(entry.name)) throw new Error('打包图片格式不正确，请重新生成图片。');
    const name = encoder.encode(entry.name);
    if (name.length > 65535 || offset + entry.blob.size + name.length + 30 > 0xffffffff) throw new Error('图片包过大，请分批生成下载。');
    const crc = await crc32(entry.blob);
    const local = binary(30);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, 0x0800, true); // UTF-8 names, stored method.
    local.view.setUint16(12, 33, true); // 1980-01-01, a valid DOS date.
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, entry.blob.size, true);
    local.view.setUint32(22, entry.blob.size, true);
    local.view.setUint16(26, name.length, true);
    parts.push(local.bytes, name, entry.blob);
    const header = binary(46);
    header.view.setUint32(0, 0x02014b50, true);
    header.view.setUint16(4, 20, true);
    header.view.setUint16(6, 20, true);
    header.view.setUint16(8, 0x0800, true);
    header.view.setUint16(14, 33, true);
    header.view.setUint32(16, crc, true);
    header.view.setUint32(20, entry.blob.size, true);
    header.view.setUint32(24, entry.blob.size, true);
    header.view.setUint16(28, name.length, true);
    header.view.setUint32(42, offset, true);
    central.push(header.bytes, name);
    centralSize += 46 + name.length;
    offset += 30 + name.length + entry.blob.size;
  }
  if (offset + centralSize + 22 > 0xffffffff) throw new Error('图片包过大，请分批生成下载。');
  const end = binary(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(8, entries.length, true);
  end.view.setUint16(10, entries.length, true);
  end.view.setUint32(12, centralSize, true);
  end.view.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.bytes], {type: 'application/zip'});
}
