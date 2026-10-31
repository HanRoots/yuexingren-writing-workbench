import test from 'node:test';
import assert from 'node:assert/strict';
import {readImageFile} from './media.js';

const MiB = 1024 * 1024;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function file({type = 'image/png', bytes = PNG, size, name = '原稿.png'} = {}) {
  const blob = new Blob([bytes], {type});
  Object.defineProperty(blob, 'name', {value: name});
  if (size !== undefined) Object.defineProperty(blob, 'size', {value: size});
  return blob;
}

function browser(t, options = {}) {
  const state = {urls: [], revoked: [], images: [], canvases: [], draws: [], fills: [], encodes: [], dataReads: [], headerReads: []};
  const prior = new Map();
  function replace(object, name, value) {
    prior.set([object, name], Object.getOwnPropertyDescriptor(object, name));
    Object.defineProperty(object, name, {configurable: true, writable: true, value});
  }
  t.after(() => {
    for (const [[object, name], descriptor] of prior) {
      if (descriptor) Object.defineProperty(object, name, descriptor);
      else delete object[name];
    }
  });
  replace(globalThis, 'FileReader', class {
    async readAsArrayBuffer(blob) {
      state.headerReads.push(blob);
      this.result = await blob.arrayBuffer();
      this.onload();
    }
    async readAsDataURL(blob) {
      state.dataReads.push(blob);
      if (options.readerFails) {this.onerror(); return;}
      this.result = options.invalidDataUrl ? 'data:,' : `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
      this.onload();
    }
  });
  replace(URL, 'createObjectURL', blob => {
    const url = `blob:photo-${state.urls.length}`;
    state.urls.push({url, blob});
    return url;
  });
  replace(URL, 'revokeObjectURL', url => state.revoked.push(url));
  replace(globalThis, 'Image', class {
    naturalWidth = options.width ?? 1200;
    naturalHeight = options.height ?? 1600;
    constructor() {state.images.push(this);}
    set src(value) {
      this.source = value;
      queueMicrotask(() => options.decodeFails ? this.onerror?.() : this.onload?.());
    }
    removeAttribute(name) {if (name === 'src') this.sourceRemoved = true;}
  });
  replace(globalThis, 'document', {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = {
        width: 300, height: 150,
        getContext() {
          if (options.noContext) return null;
          const ctx = {
            fillRect(...args) {state.fills.push({color: ctx.fillStyle, args});},
            drawImage(...args) {
              if (options.drawFails) throw new Error('draw failed');
              state.draws.push(args);
            },
          };
          return ctx;
        },
        toBlob(callback, mime, quality) {
          if (options.encodeThrows) throw new Error('encoding failed');
          const index = state.encodes.length;
          state.encodes.push({width: this.width, height: this.height, mime, quality});
          let blob = new Blob([JPEG], {type: options.outputMime ?? mime});
          if (options.outputSizes) Object.defineProperty(blob, 'size', {value: options.outputSizes[Math.min(index, options.outputSizes.length - 1)]});
          if (options.emptyEncoding) blob = null;
          queueMicrotask(() => callback(blob));
        },
      };
      state.canvases.push(canvas);
      return canvas;
    },
  });
  return state;
}

function released(state) {
  assert.deepEqual(state.revoked, state.urls.map(({url}) => url));
  for (const image of state.images) {
    assert.equal(image.onload, null);
    assert.equal(image.onerror, null);
    assert.equal(image.sourceRemoved, true);
  }
  for (const canvas of state.canvases) {
    assert.equal(canvas.width, 0);
    assert.equal(canvas.height, 0);
  }
}

test('48MP landscape photos become a full 4096×3072 JPEG without reading original Base64', async t => {
  const state = browser(t, {width: 8000, height: 6000});
  const original = file();
  const result = await readImageFile(original);
  assert.equal(result.optimized, true);
  assert.equal(result.width, 4096);
  assert.equal(result.height, 3072);
  assert.match(result.dataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(result.name, original.name);
  assert.equal(state.dataReads.length, 1);
  assert.notEqual(state.dataReads[0], original);
  assert.equal(state.urls[0].blob, original);
  assert.deepEqual(state.encodes, [{width: 4096, height: 3072, mime: 'image/jpeg', quality: 0.95}]);
  assert.deepEqual(state.draws[0].slice(1), [0, 0, 4096, 3072]);
  assert.equal(state.fills[0].color, '#FFFFFF');
  released(state);
});

test('portrait dimensions retain orientation and aspect ratio', async t => {
  const state = browser(t, {width: 6000, height: 8000});
  const result = await readImageFile(file());
  assert.equal(result.width, 3072);
  assert.equal(result.height, 4096);
  assert.deepEqual(state.draws[0].slice(1), [0, 0, 3072, 4096]);
  released(state);
});

test('ordinary photos retain their MIME and original bytes', async t => {
  const state = browser(t);
  const original = file();
  const result = await readImageFile(original);
  assert.equal(result.optimized, false);
  assert.equal(result.dataUrl, `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`);
  assert.equal(result.width, 1200);
  assert.equal(result.height, 1600);
  assert.equal(state.dataReads[0], original);
  assert.equal(state.canvases.length, 0);
  released(state);
});

test('files over 15MiB are optimized instead of rejected, without upscaling', async t => {
  const state = browser(t, {width: 3000, height: 2000});
  const original = file({size: 16 * MiB});
  const result = await readImageFile(original);
  assert.equal(result.optimized, true);
  assert.equal(result.width, 3000);
  assert.equal(result.height, 2000);
  assert.notEqual(state.dataReads[0], original);
  released(state);
});

test('files above 100MiB are rejected before reading or allocating an object URL', async t => {
  const state = browser(t);
  await assert.rejects(readImageFile(file({size: 100 * MiB + 1})), /不能超过 100 MB/);
  assert.equal(state.headerReads.length, 0);
  assert.equal(state.urls.length, 0);
});

test('MIME disguises and unsupported formats are rejected before decoding', async t => {
  const state = browser(t);
  await assert.rejects(readImageFile(file({type: 'image/jpeg'})), /内容与图片格式不符/);
  await assert.rejects(readImageFile(file({type: 'image/svg+xml'})), /仅支持/);
  assert.equal(state.urls.length, 0);
});

test('decode failures release object URL and image handlers', async t => {
  const state = browser(t, {decodeFails: true});
  await assert.rejects(readImageFile(file()), /无法解码/);
  assert.equal(state.canvases.length, 0);
  released(state);
});

test('invalid decoded dimensions release object URL', async t => {
  const state = browser(t, {width: 0});
  await assert.rejects(readImageFile(file()), /照片尺寸无效/);
  released(state);
});

for (const [label, options, error] of [
  ['missing Canvas context', {noContext: true}, /浏览器无法处理/],
  ['Canvas draw failure', {drawFails: true}, /浏览器无法缩小/],
  ['empty encoding', {emptyEncoding: true}, /未能优化/],
  ['encoding exception', {encodeThrows: true}, /照片优化失败/],
  ['unsupported JPEG encoder', {outputMime: 'image/png'}, /未能优化/],
  ['final Base64 read failure', {readerFails: true}, /无法读取/],
  ['invalid final data URL', {invalidDataUrl: true}, /照片读取失败/],
]) {
  test(`${label} rejects invalid page and releases resources`, async t => {
    const state = browser(t, {width: 8000, height: 6000, ...options});
    await assert.rejects(readImageFile(file()), error);
    released(state);
  });
}

test('oversized JPEG outputs are scaled again at high quality until below 8MiB', async t => {
  const state = browser(t, {width: 8000, height: 6000, outputSizes: [16 * MiB, 9 * MiB, 5 * MiB]});
  const result = await readImageFile(file());
  assert.equal(state.encodes.length, 3);
  const secondScale = Math.sqrt(8 / 16) * 0.9;
  assert.equal(state.encodes[1].width, Math.floor(4096 * secondScale));
  assert.equal(state.encodes[1].height, Math.floor(3072 * secondScale));
  const thirdScale = Math.sqrt(8 / 9) * 0.9;
  assert.equal(result.width, Math.floor(state.encodes[1].width * thirdScale));
  assert.equal(result.height, Math.floor(state.encodes[1].height * thirdScale));
  assert.equal(state.dataReads[0].size, 5 * MiB);
  assert.ok(state.encodes.every(item => item.quality === 0.95 && item.width <= 4096 && item.height <= 4096));
  released(state);
});

test('encoding is bounded to one initial attempt plus three resize retries', async t => {
  const state = browser(t, {width: 8000, height: 6000, outputSizes: [9 * MiB]});
  await assert.rejects(readImageFile(file()), /优化后仍超过 8 MB/);
  assert.equal(state.encodes.length, 4);
  assert.equal(state.dataReads.length, 0);
  released(state);
});
