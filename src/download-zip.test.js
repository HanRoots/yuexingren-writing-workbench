import test from 'node:test';
import assert from 'node:assert/strict';
import {crc32, createImageZip} from './download-zip.js';

test('CRC32 matches the ZIP standard check value', async () => {
  assert.equal(await crc32(new Blob(['123456789'])), 0xcbf43926);
});

test('ZIP preserves UTF-8 filenames, file bytes and central-directory offsets', async () => {
  const entries = [{name:'习作-A4-第01页.png',blob:new Blob(['PNG-content'])}, {name:'习作-A4-第02页.png',blob:new Blob(['second-page'])}];
  const zip = await createImageZip(entries);
  assert.equal(zip.type,'application/zip');
  const buffer = await zip.arrayBuffer();
  const view = new DataView(buffer); const bytes = new Uint8Array(buffer); const decoder = new TextDecoder();
  let offset = 0;
  for (const entry of entries) {
    assert.equal(view.getUint32(offset,true),0x04034b50);
    assert.equal(view.getUint16(offset+6,true),0x0800);
    const length=view.getUint16(offset+26,true), size=view.getUint32(offset+18,true);
    assert.equal(decoder.decode(bytes.slice(offset+30,offset+30+length)),entry.name);
    assert.equal(decoder.decode(bytes.slice(offset+30+length,offset+30+length+size)),await entry.blob.text());
    assert.equal(view.getUint32(offset+14,true),await crc32(entry.blob));
    offset += 30+length+size;
  }
  assert.equal(view.getUint32(offset,true),0x02014b50);
  const end=buffer.byteLength-22;
  assert.equal(view.getUint32(end,true),0x06054b50);
  assert.equal(view.getUint16(end+10,true),2);
  assert.equal(view.getUint32(end+16,true),offset);
  assert.equal(view.getUint32(offset+42,true),0);
});

test('invalid or path-containing archive entries are rejected', async () => {
  await assert.rejects(createImageZip([]),/没有可打包/);
  await assert.rejects(createImageZip([{name:'../page.png',blob:new Blob(['x'])}]),/格式不正确/);
});
