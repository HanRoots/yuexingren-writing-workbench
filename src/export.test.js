import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudent, confirmBody, confirmQuote} from './domain.js';
import {renderStudentPages, A4_SIZE} from './export.js';

function approved(patch = {}) {
  let student = createStudent({title: '排版验收', body: '这是测试文字。', pages: [
    {id: 'source-1', name: '原稿.jpg', dataUrl: 'portrait', width: 900, height: 1200},
  ], ...patch});
  student = confirmBody(student);
  return student.includeQuote ? confirmQuote(student) : student;
}

function mockBrowser() {
  const oldDocument = globalThis.document;
  const oldImage = globalThis.Image;
  globalThis.Image = class {
    set src(value) {
      this.source = value;
      [this.naturalWidth, this.naturalHeight] = value.includes('logo') ? [240, 230]
        : value === 'landscape' ? [1600, 900] : [900, 1200];
      queueMicrotask(() => this.onload?.());
    }
    removeAttribute() {}
  };
  globalThis.document = {
    fonts: {load: async () => [], ready: Promise.resolve()},
    createElement() {
      const ctx = {
        text: [], images: [], boxes: [], font: '34px MiSans',
        measureText(text) {return {width: Array.from(text).length * (Number(/(\d+)px/.exec(this.font)?.[1]) || 34)};},
        fillText(text, x, y) {this.text.push({text, x, y, font: this.font});},
        drawImage(image, ...rect) {this.images.push({source: image.source, rect});},
        roundRect(x, y, w, h) {assert.ok(Number.isFinite(h) && h > 0); this.boxes.push({x,y,w,h});},
        beginPath() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, arc() {}, fillRect() {}, scale() {},
        getImageData() {return {};},
      };
      return {width: 0, height: 0, getContext: () => ctx, ctx};
    },
  };
  return () => {globalThis.document = oldDocument; globalThis.Image = oldImage;};
}

async function render(student, format) {
  const snapshots = [];
  for await (const canvas of renderStudentPages(student, {format})) snapshots.push({
    width: canvas.width, height: canvas.height, text: canvas.ctx.text, images: canvas.ctx.images, boxes: canvas.ctx.boxes,
  });
  return snapshots;
}

test('A4 fixes every output page size and fits each complete source photo', async () => {
  const restore = mockBrowser();
  try {
    const pages = await render(approved({pages: [
      {id:'1', name:'1.jpg', dataUrl:'portrait', width:900, height:1200},
      {id:'2', name:'2.jpg', dataUrl:'landscape', width:1600, height:900},
    ]}), 'a4');
    assert.equal(pages.length, 3);
    for (const page of pages) assert.deepEqual([page.width,page.height], [A4_SIZE.width,A4_SIZE.height]);
    const photos = pages.flatMap(p => p.images).filter(i => !i.source.includes('logo'));
    assert.deepEqual(photos.map(p => p.source), ['portrait','landscape']);
    for (const [i, photo] of photos.entries()) {
      assert.equal(photo.rect.length, 4, 'uses fit, never a cropped drawImage call');
      const [x,y,w,h] = photo.rect;
      assert.ok(x >= 104 && x + w <= 1336.01);
      assert.ok(y >= 260 && y + h < 1870);
      assert.ok(Math.abs(w/h - (i ? 1600/900 : 900/1200)) < 1e-8);
    }
  } finally {restore();}
});

test('long A4 text and excerpts paginate without missing or duplicating content', async () => {
  const restore = mockBrowser();
  try {
    const quote = '完整摘录'.repeat(200) + '。';
    const body = quote + '\n' + Array.from({length: 90}, (_,i) => `段落${i}：` + '这是保留顺序的正文内容。'.repeat(5)).join('\n');
    const pages = await render(approved({body,quote,includeQuote:true}), 'a4');
    assert.ok(pages.length > 8);
    const ops = pages.flatMap(p => p.text);
    const excerptText = ops.filter(op => op.font.startsWith('700 44px')).map(op => op.text).join('');
    const bodyText = ops.filter(op => op.font.startsWith('400 34px')).map(op => op.text).join('');
    assert.equal(excerptText, quote);
    assert.equal(bodyText, body.replaceAll('\n',''));
    for (const op of ops) {
      if (op.font.startsWith('400 34px') || op.font.startsWith('700 44px')) {
        assert.ok(op.y >= 120 && op.y + parseInt(op.font.match(/(\d+)px/)[1]) < 1870);
      }
    }
    for (const page of pages) for (const box of page.boxes) assert.ok(box.y + box.h < 1870);
  } finally {restore();}
});

test('letter formatting preserves salutation, right-aligned signature and date', async () => {
  const restore = mockBrowser();
  try {
    const pages = await render(approved({name:'测试署名', body:'亲爱的朋友：\n你好！\n这是一段正文。\n此致\n敬礼！\n测试署名\n2026年11月7日'}), 'a4');
    const ops = pages[0].text;
    assert.equal(ops.find(op=>op.text==='亲爱的朋友：').x,160);
    assert.equal(ops.find(op=>op.text==='此致').x,228);
    assert.equal(ops.find(op=>op.text==='敬礼！').x,160);
    const signature = ops.find(op=>op.text==='测试署名' && op.font.startsWith('400 34px'));
    assert.ok(signature.x > 1000);
    assert.ok(ops.find(op=>op.text==='2026年11月7日').x > 800);
  } finally {restore();}
});

test('very long titles and varying excerpt lengths do not create empty or clipped body panels', async () => {
  const restore = mockBrowser();
  try {
    const title = '完整长题目'.repeat(120);
    const titlePages = await render(approved({title}), 'a4');
    assert.equal(titlePages.flatMap(p => p.text).filter(op=>op.font.startsWith('700 72px')).map(op=>op.text).join(''), title);
    for (let n = 1; n <= 90; n += 4) {
      const quote = '这是完整摘录'.repeat(n) + '。';
      const pages = await render(approved({body: quote + '\n最后一段正文。', quote, includeQuote:true}), 'a4');
      const text = pages.flatMap(p=>p.text).filter(op=>op.font.startsWith('400 34px')).map(op=>op.text).join('');
      assert.equal(text,quote+'最后一段正文。');
    }
  } finally {restore();}
});

test('long option preserves a single 1440-pixel wide image', async () => {
  const restore = mockBrowser();
  try {
    const pages = await render(approved(), 'long');
    assert.equal(pages.length, 1); assert.equal(pages[0].width,1440);
    assert.ok(pages[0].height > 2037);
    assert.ok(pages[0].text.some(op=>op.text==='这是测试文字。'));
  } finally {restore();}
});

test('both sizes enforce confirmation and reject unknown formats', async () => {
  const restore = mockBrowser();
  try {
    const draft = createStudent({title:'题目',body:'正文。',pages:[{dataUrl:'portrait'}]});
    await assert.rejects(render(draft,'a4'), /确认当前正文/);
    await assert.rejects(render(draft,'long'), /确认当前正文/);
    await assert.rejects(render(approved(),'unknown'), /请选择长图或 A4/);
  } finally {restore();}
});
