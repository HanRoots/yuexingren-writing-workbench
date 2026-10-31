/**
 * Pure workflow rules for one student's manuscript.
 * All operations return a new record; only confirmBody / confirmQuote can grant
 * confirmation. No names, dates, titles or manuscript text are invented here.
 *
 * @typedef {{id:string,name:string,dataUrl:string,width:number,height:number}} Page
 * @typedef {{id:string,name:string,title:string,subtitle:string,date:string,
 * body:string,quote:string,includeQuote:boolean,bodyConfirmed:boolean,
 * quoteConfirmed:boolean,uncertainties:string[],pages:Page[]}} Student
 */

const TEXT_FIELDS = ['name', 'title', 'subtitle', 'date', 'body', 'quote'];
const BODY_METADATA_FIELDS = ['name', 'title', 'date'];
const PAGE_FIELDS = ['id', 'name', 'dataUrl', 'width', 'height'];
const SENTENCE_ENDINGS = new Set(['。', '.', '!', '?', '！', '？']);
const CLOSING_MARKS = new Set(['”', '’', '」', '』', '》', '〉', '】', '）', ')', ']', '}', '»', '"', "'"]);
const QUOTE_ERROR = '摘录必须是当前正文中的完整原句，字词和标点保持一致';

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `student-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function textValue(value, key) {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new TypeError(`${key} 必须是文字`);
  return value;
}

function copyPages(pages = []) {
  if (!Array.isArray(pages)) throw new TypeError('pages 必须是数组');
  return pages.map((page) => {
    if (!page || typeof page !== 'object') throw new TypeError('原稿页面格式不正确');
    return {
      id: textValue(page.id, 'page.id'),
      name: textValue(page.name, 'page.name'),
      dataUrl: textValue(page.dataUrl, 'page.dataUrl'),
      width: Number(page.width) || 0,
      height: Number(page.height) || 0,
    };
  });
}

function copyUncertainties(uncertainties = []) {
  if (!Array.isArray(uncertainties) || uncertainties.some((item) => typeof item !== 'string')) {
    throw new TypeError('uncertainties 必须是文字数组');
  }
  return uncertainties.filter((item) => item.trim().length > 0);
}

/** @param {Partial<Student>} [seed] @returns {Student} */
export function createStudent(seed = {}) {
  const student = {
    id: typeof seed.id === 'string' && seed.id ? seed.id : newId(),
    ...Object.fromEntries(TEXT_FIELDS.map((key) => [key, textValue(seed[key], key)])),
    includeQuote: seed.includeQuote === undefined ? Boolean(seed.quote) : Boolean(seed.includeQuote),
    bodyConfirmed: false,
    quoteConfirmed: false,
    uncertainties: copyUncertainties(seed.uncertainties),
    pages: copyPages(seed.pages),
  };
  return student;
}

/**
 * Patch editable fields. Confirmation flags and identity cannot be patched.
 * @param {Student} student
 * @param {Partial<Student>} patch
 * @returns {Student}
 */
export function updateStudent(student, patch = {}) {
  // Typing in a text field must not copy or serialize every base64 manuscript.
  // Untouched collections retain their references; replaced ones are copied.
  const next = { ...student };
  for (const key of TEXT_FIELDS) {
    if (Object.hasOwn(patch, key)) next[key] = textValue(patch[key], key);
  }
  if (Object.hasOwn(patch, 'includeQuote')) next.includeQuote = Boolean(patch.includeQuote);
  let pagesChanged = false;
  if (Object.hasOwn(patch, 'pages')) {
    next.pages = copyPages(patch.pages);
    pagesChanged = next.pages.length !== student.pages.length || next.pages.some((page, index) => (
      PAGE_FIELDS.some((key) => page[key] !== student.pages[index][key])
    ));
  }
  let uncertaintiesChanged = false;
  if (Object.hasOwn(patch, 'uncertainties')) {
    next.uncertainties = copyUncertainties(patch.uncertainties);
    uncertaintiesChanged = next.uncertainties.length !== student.uncertainties.length
      || next.uncertainties.some((item, index) => item !== student.uncertainties[index]);
  }

  const bodyChanged = next.body !== student.body;
  const subtitleChanged = next.subtitle !== student.subtitle;
  const metadataChanged = BODY_METADATA_FIELDS.some((key) => next[key] !== student[key]);
  if (bodyChanged || subtitleChanged || pagesChanged || uncertaintiesChanged || metadataChanged) {
    next.bodyConfirmed = false;
  }
  if (bodyChanged || subtitleChanged || pagesChanged || uncertaintiesChanged
      || next.quote !== student.quote || next.includeQuote !== student.includeQuote) {
    next.quoteConfirmed = false;
  }
  return next;
}

/** AI must preserve an unresolved character as a marker instead of guessing. */
export function hasPendingMarkers(student) {
  return student.body.includes('【待确认');
}

export function hasUnresolvedUncertainties(student) {
  return student.uncertainties.some((item) => item.trim().length > 0) || hasPendingMarkers(student);
}

function isSentenceStart(body, index) {
  let cursor = index - 1;
  // Indentation and spaces after a sentence do not change its boundary. Keep
  // newlines visible: a child may omit punctuation at the end of a paragraph.
  while (cursor >= 0 && /[^\S\n]/u.test(body[cursor])) cursor -= 1;
  if (cursor < 0 || body[cursor] === '\n') return true;
  while (cursor >= 0 && CLOSING_MARKS.has(body[cursor])) cursor -= 1;
  return SENTENCE_ENDINGS.has(body[cursor]);
}

function isSentenceEnd(body, index) {
  let cursor = index - 1;
  while (cursor >= 0 && CLOSING_MARKS.has(body[cursor])) cursor -= 1;
  if (SENTENCE_ENDINGS.has(body[cursor])) return true;
  cursor = index;
  while (cursor < body.length && /[^\S\n]/u.test(body[cursor])) cursor += 1;
  return cursor === body.length || body[cursor] === '\n';
}

/** Exact original sentences, including an unpunctuated complete paragraph. */
export function isQuoteExact(student) {
  const { body, quote } = student;
  if (!quote.trim()) return false;
  const leadingWhitespace = quote.length - quote.trimStart().length;
  const meaningfulLength = quote.trimEnd().length;
  let index = body.indexOf(quote);
  // The same words may first appear inside a longer sentence and later as a
  // full sentence. Accept only an occurrence with valid boundaries on both ends.
  while (index >= 0) {
    if (isSentenceStart(body, index + leadingWhitespace)
        && isSentenceEnd(body, index + meaningfulLength)) return true;
    index = body.indexOf(quote, index + 1);
  }
  return false;
}

function assertBodyReady(student) {
  if (!student.body.trim()) throw new Error('请先填写或识别正文');
  if (hasUnresolvedUncertainties(student)) {
    throw new Error('请先核对疑难字，并处理正文中的【待确认】标记');
  }
}

/** @param {Student} student @returns {Student} */
export function confirmBody(student) {
  assertBodyReady(student);
  return { ...student, bodyConfirmed: true };
}

/** @param {Student} student @returns {Student} */
export function confirmQuote(student) {
  assertBodyReady(student);
  if (!student.includeQuote) throw new Error('本图不设摘录，无需确认摘录');
  if (!isQuoteExact(student)) throw new Error(QUOTE_ERROR);
  return { ...student, quoteConfirmed: true };
}

/** @param {Student} student @returns {string[]} */
export function exportBlockingReasons(student) {
  const reasons = [];
  if (!student.title.trim()) reasons.push('请填写原稿题目');
  if (!student.body.trim()) reasons.push('请先填写或识别正文');
  if (!student.pages.length) reasons.push('请至少上传一页手写原稿');
  if (hasUnresolvedUncertainties(student)) reasons.push('请先核对疑难字，并处理正文中的【待确认】标记');
  if (!student.bodyConfirmed) reasons.push('请确认当前正文');
  if (student.includeQuote) {
    if (!isQuoteExact(student)) reasons.push(QUOTE_ERROR);
    if (!student.quoteConfirmed) reasons.push('请确认当前摘录');
  }
  return reasons;
}

/** @param {Student} student @returns {boolean} */
export function canExport(student) {
  return exportBlockingReasons(student).length === 0;
}
