import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStudent, updateStudent, confirmBody, confirmQuote, canExport,
  exportBlockingReasons, hasPendingMarkers, isQuoteExact,
} from './domain.js';

const page = (id = 'page-1') => ({ id, name: `${id}.jpg`, dataUrl: `data:image/jpeg;base64,${id}`, width: 900, height: 1200 });
const draft = (patch = {}) => createStudent({
  title: '一次观察', body: '我在窗边看见了一只小鸟。\n它轻轻地飞走了。',
  pages: [page()], ...patch,
});
const approved = () => confirmQuote(confirmBody(draft({ includeQuote: true, quote: '它轻轻地飞走了。' })));

test('new students have no fabricated metadata and cannot inherit confirmations', () => {
  const student = createStudent({ bodyConfirmed: true, quoteConfirmed: true });
  assert.ok(student.id);
  for (const key of ['name', 'title', 'subtitle', 'date', 'body', 'quote']) assert.equal(student[key], '');
  assert.equal(student.bodyConfirmed, false);
  assert.equal(student.quoteConfirmed, false);
  assert.equal(canExport(student), false);
});

test('no-quote workflow needs body confirmation and the original manuscript', () => {
  const student = draft();
  assert.equal(canExport(student), false);
  assert.equal(canExport(confirmBody(student)), true);
  assert.equal(canExport(confirmBody(draft({ pages: [] }))), false);
  assert.match(exportBlockingReasons(confirmBody(draft({ pages: [] }))).join('；'), /手写原稿/);
});

test('body confirmation never implies quote confirmation', () => {
  const student = confirmBody(draft({ includeQuote: true, quote: '它轻轻地飞走了。' }));
  assert.equal(student.quoteConfirmed, false);
  assert.equal(canExport(student), false);
  assert.equal(canExport(confirmQuote(student)), true);
});

test('unresolved OCR questions and inline markers both prevent body confirmation', () => {
  assert.throws(() => confirmBody(draft({ uncertainties: ['第二页第一行的字待核对'] })), /疑难字/);
  assert.throws(() => confirmBody(draft({ body: '我看见了【待确认】。' })), /待确认/);
  assert.throws(() => confirmBody(draft({ body: '我看见了【待确认：这个字】。' })), /待确认/);
  assert.equal(hasPendingMarkers(draft({ body: '【待确认' })), true);
  assert.throws(() => confirmBody(draft({ body: ' \n ' })), /正文/);
});

test('clearing a question list does not silently remove a pending marker', () => {
  const student = updateStudent(draft({ body: '我看见了【待确认】。', uncertainties: ['请核对'] }), { uncertainties: [] });
  assert.throws(() => confirmBody(student), /待确认/);
  assert.equal(canExport(confirmBody(updateStudent(student, { body: '我看见了小鸟。' }))), true);
});

test('excerpt validation is character-for-character, including punctuation', () => {
  for (const quote of ['它轻轻地飞走了!', '它轻轻地飞走了。 ', '它轻轻地飞走啦。', '']) {
    const student = draft({ quote, includeQuote: true });
    assert.equal(isQuoteExact(student), false);
    assert.throws(() => confirmQuote(student), /完整原句，字词和标点保持一致/);
  }
  assert.equal(isQuoteExact(draft({ quote: '它轻轻地飞走了。', includeQuote: true })), true);
});

test('manual excerpts must cover a complete sentence instead of a middle fragment', () => {
  const body = '我在窗边看见了一只小鸟。它轻轻地飞走了。';
  for (const quote of ['看见了一只小鸟。', '它轻轻地', '轻轻地飞走了。', '我在窗边看见']) {
    const student = draft({ body, quote, includeQuote: true });
    assert.equal(isQuoteExact(student), false, quote);
    assert.throws(() => confirmQuote(student), /完整原句/);
  }
  for (const quote of ['我在窗边看见了一只小鸟。', '它轻轻地飞走了。', body]) {
    assert.equal(isQuoteExact(draft({ body, quote })), true, quote);
  }
});

test('sentence boundaries include closing quotation marks, brackets and whitespace', () => {
  const examples = [
    { body: '他说：“今天真好。”我们一起出门。', quote: '我们一起出门。' },
    { body: '（他说：“今天真好！”）  我们一起出门。', quote: '我们一起出门。' },
    { body: '我说完了。\n　　“今天真好！”\n我们出门。', quote: '“今天真好！”' },
    { body: '前一句。  我看见了小鸟。 下一句。', quote: '我看见了小鸟。' },
    { body: 'First. I saw a bird! Then it flew?', quote: 'I saw a bird! Then it flew?' },
    { body: '我说：“小鸟”，然后出门。', quote: '然后出门。', valid: false },
  ];
  for (const { body, quote, valid = true } of examples) {
    assert.equal(isQuoteExact(draft({ body, quote })), valid, quote);
  }
});

test('a complete unpunctuated paragraph is allowed without admitting a partial clause', () => {
  const body = '今天我在窗边看鸟\n　　它突然飞了起来\n我继续看着天空';
  for (const quote of ['今天我在窗边看鸟', '它突然飞了起来', '我继续看着天空']) {
    assert.equal(isQuoteExact(draft({ body, quote })), true, quote);
  }
  for (const quote of ['在窗边看鸟', '它突然', '继续看着天空']) {
    assert.equal(isQuoteExact(draft({ body, quote })), false, quote);
  }
});

test('a repeated phrase is accepted only if at least one occurrence is a full sentence', () => {
  const quote = '看鸟。';
  assert.equal(isQuoteExact(draft({ body: '我只说要看鸟。\n看鸟。\n这是我的计划。', quote })), true);
  assert.equal(isQuoteExact(draft({ body: '我只说要看鸟。后来继续看鸟。', quote })), false);
});

test('even a punctuation edit withdraws both approvals', () => {
  const original = approved();
  const changed = updateStudent(original, { body: `${original.body}！` });
  assert.equal(changed.bodyConfirmed, false);
  assert.equal(changed.quoteConfirmed, false);
  assert.equal(canExport(changed), false);
  assert.equal(original.bodyConfirmed, true);
  assert.equal(original.quoteConfirmed, true);
});

test('changing an excerpt preserves body approval but requires excerpt approval again', () => {
  const changed = updateStudent(approved(), { quote: '我在窗边看见了一只小鸟。' });
  assert.equal(changed.bodyConfirmed, true);
  assert.equal(changed.quoteConfirmed, false);
  assert.equal(canExport(changed), false);
  assert.equal(canExport(confirmQuote(changed)), true);
});

test('removing a quote permits approved text export; reenabling it requires confirmation', () => {
  const withoutQuote = updateStudent(approved(), { includeQuote: false });
  assert.equal(withoutQuote.bodyConfirmed, true);
  assert.equal(withoutQuote.quoteConfirmed, false);
  assert.equal(canExport(withoutQuote), true);
  assert.throws(() => confirmQuote(withoutQuote), /不设摘录/);
  assert.equal(canExport(updateStudent(withoutQuote, { includeQuote: true })), false);
});

test('photos are copied and any source replacement or page reordering withdraws approvals', () => {
  const original = approved();
  for (const pages of [[page('other')], [], [page(), page('page-2')]]) {
    const changed = updateStudent(original, { pages });
    assert.equal(changed.bodyConfirmed, false);
    assert.equal(changed.quoteConfirmed, false);
  }
  const withTwo = confirmQuote(confirmBody(updateStudent(original, { pages: [page(), page('page-2')] })));
  const reordered = updateStudent(withTwo, { pages: [...withTwo.pages].reverse() });
  assert.equal(reordered.bodyConfirmed, false);
  assert.equal(reordered.quoteConfirmed, false);
  const unchanged = updateStudent(original, { pages: [page()] });
  assert.equal(unchanged.bodyConfirmed, true);
  assert.notEqual(unchanged.pages[0], original.pages[0]);
});

test('editing manuscript metadata requires body review; subtitle also requires excerpt review', () => {
  for (const patch of [{ name: '用户填写的姓名' }, { title: '用户填写的题目' }, { date: '用户填写的日期' }, { subtitle: '用户填写的副标题' }]) {
    const changed = updateStudent(approved(), patch);
    assert.equal(changed.bodyConfirmed, false);
  }
  assert.equal(updateStudent(approved(), { subtitle: '用户填写的副标题' }).quoteConfirmed, false);
});

test('patches cannot grant confirmation or replace identity', () => {
  const student = draft({ id: 'stable-id' });
  const patched = updateStudent(student, { id: 'other-id', bodyConfirmed: true, quoteConfirmed: true });
  assert.equal(patched.id, 'stable-id');
  assert.equal(patched.bodyConfirmed, false);
  assert.equal(patched.quoteConfirmed, false);
});

test('export rechecks the current data even if imported confirmation booleans are true', () => {
  for (const changed of [
    { ...approved(), quote: '正文里没有的话' },
    { ...approved(), uncertainties: ['一个未解决的字'] },
    { ...approved(), body: '【待确认】' },
    { ...approved(), pages: [] },
    { ...approved(), title: '' },
  ]) assert.equal(canExport(changed), false);
});

test('a no-op autosave preserves approvals and leaves input records untouched', () => {
  const original = approved();
  const serialized = JSON.stringify(original);
  const next = updateStudent(original, { body: original.body, quote: original.quote, title: original.title });
  assert.equal(canExport(next), true);
  assert.equal(JSON.stringify(original), serialized);
  assert.notEqual(next, original);
});

test('typing does not traverse or serialize untouched photos and uncertainty arrays', () => {
  const original = approved();
  const unreadable = (items) => new Proxy(items, {
    get() { throw new Error('A text edit must not traverse an unchanged collection'); },
  });
  const student = {
    ...original,
    pages: unreadable(original.pages),
    uncertainties: unreadable(original.uncertainties),
  };
  const next = updateStudent(student, { body: `${student.body}今天。` });
  assert.equal(next.pages, student.pages);
  assert.equal(next.uncertainties, student.uncertainties);
  assert.equal(next.bodyConfirmed, false);
  assert.equal(next.quoteConfirmed, false);
});

test('explicit photo updates compare fields without calling JSON serializers', () => {
  const original = approved();
  Object.defineProperty(original.pages[0], 'toJSON', {
    value() { throw new Error('Manuscript base64 must not be serialized to compare pages'); },
  });
  const unchanged = updateStudent(original, { pages: [page()] });
  assert.equal(canExport(unchanged), true);
  const changed = updateStudent(original, { pages: [{ ...page(), dataUrl: 'data:image/jpeg;base64,new' }] });
  assert.equal(changed.bodyConfirmed, false);
  assert.equal(changed.quoteConfirmed, false);
});

test('unchanged uncertainty values preserve approval, while a new question revokes it', () => {
  const original = approved();
  const same = updateStudent(original, { uncertainties: [] });
  assert.equal(canExport(same), true);
  assert.notEqual(same.uncertainties, original.uncertainties);
  const changed = updateStudent(original, { uncertainties: ['请核对第二页'] });
  assert.equal(changed.bodyConfirmed, false);
  assert.equal(changed.quoteConfirmed, false);
});
