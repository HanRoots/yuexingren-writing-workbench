import { canExport, exportBlockingReasons } from './domain.js';

const W = 1440;
const OUTER = 104;
const PAD = 56;
const TEXT_X = OUTER + PAD;
const TEXT_W = W - TEXT_X * 2;
const FONT = 'MiSans, "MiSans Local", "Microsoft YaHei", "PingFang SC", sans-serif';
const C = {
  navy: '#2A2973', text: '#22243D', muted: '#646B82', line: '#DEE3EE',
  surface: '#F7F8FC', quote: '#F3F8DE', green: '#ACCE22', white: '#FFFFFF',
};
const NO_START = new Set(Array.from('，。！？；：、）】》〉」』〕］｝”’％%…—,.!?;:)]}'));
const NO_END = new Set(Array.from('（【《〈「『〔［｛“‘([{'));
const MAX_HEIGHT = 32760;
const MAX_PIXELS = 48_000_000;

function font(ctx, size, weight = 400) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textBaseline = 'top';
}

// Wrap by the font's actual advance widths. Never use commas as break points.
// Closing punctuation travels with the preceding character, and an opening
// bracket travels with the following character. No text is removed or added.
function wrap(ctx, text, width, firstIndent = 0) {
  const result = [];
  let line = '';
  let available = width - firstIndent;
  for (const char of Array.from(text.replace(/\r\n?/g, '\n'))) {
    if (char === '\n') {
      result.push(line);
      line = '';
      available = width;
      continue;
    }
    if (line && ctx.measureText(line + char).width > available) {
      let carried = '';
      const current = Array.from(line);
      if ((NO_START.has(char) || NO_END.has(current.at(-1))) && current.length > 1) {
        carried = current.pop();
        // Do not strand several opening marks at the end of the previous line.
        while (current.length > 1 && NO_END.has(current.at(-1))) carried = current.pop() + carried;
        line = current.join('');
      }
      result.push(line);
      line = carried + char;
      available = width;
    } else {
      line += char;
    }
  }
  if (line || !result.length) result.push(line);
  return result;
}

function wrappedBlock(ctx, text, size, width, x, y, lineHeight, color, weight = 400, indent = 0) {
  font(ctx, size, weight);
  return wrap(ctx, text, width, indent).map((line, i) => ({
    text: line, x: x + (i === 0 ? indent : 0), y: y + i * lineHeight,
    size, weight, color,
  }));
}

function paintText(ctx, ops) {
  for (const op of ops) {
    font(ctx, op.size, op.weight);
    ctx.fillStyle = op.color;
    ctx.fillText(op.text, op.x, op.y);
  }
}

function roundRect(ctx, x, y, width, height, fill = C.white) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 20);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function rule(ctx, x1, y, x2) {
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function section(ctx, number, label, y) {
  font(ctx, 32);
  ctx.fillStyle = C.navy;
  ctx.fillText(number, OUTER, y + 11);
  ctx.beginPath();
  ctx.arc(187.5, y + 35, 7.5, 0, Math.PI * 2);
  ctx.fillStyle = C.green;
  ctx.fill();
  font(ctx, 48, 700);
  ctx.fillStyle = C.navy;
  ctx.fillText(label, 214, y);
  rule(ctx, 560, y + 37, W - OUTER);
}

function imageFrom(source, description) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) reject(new Error(`${description}尺寸无效，请重新选择图片。`));
      else resolve(img);
    };
    img.onerror = () => reject(new Error(`${description}加载失败，请重新选择图片后再试。`));
    img.src = source;
  });
}

function bodyLayout(ctx, student, top, options = {}) {
  const rows = student.body.replace(/\r\n?/g, '\n').split('\n');
  const filled = rows.map((text, index) => ({text: text.trim(), index})).filter(row => row.text);
  const first = filled[0];
  const lastIndexes = new Set(filled.slice(-3).map(row => row.index));
  const isLetter = Boolean(first && first.text.length <= 42 && /[：:]$/.test(first.text));
  const ops = [];
  let y = top + 72;
  let previousBlank = false;
  for (let i = 0; i < rows.length; i += 1) {
    const text = rows[i].trim();
    if (!text) {
      // Preserve paragraph spacing without turning multiple blank lines into
      // an unbounded empty canvas region.
      if (!previousBlank && ops.length) y += 16;
      previousBlank = true;
      continue;
    }
    previousBlank = false;
    const isSalutation = isLetter && i === first.index;
    const isRespect = /^敬礼[！!。.]?$/.test(text);
    const isSincerely = /^此致[！!。.]?$/.test(text);
    const isDate = lastIndexes.has(i) && /^(?:\d{2,4}[年./-]\s*\d{1,2}[月./-]\s*\d{1,2}日?|\d{1,2}月\s*\d{1,2}日)$/.test(text);
    const isSignature = lastIndexes.has(i) && Boolean(student.name?.trim()) &&
      (text === student.name.trim() || new RegExp(`^(?:您的|你的|学生|儿子|女儿|爱您的|爱你的)[：: ]*${escapeRegExp(student.name.trim())}$`).test(text));
    const size = isSalutation ? (options.salutationSize ?? 43) : (options.bodySize ?? 36);
    const indent = isSalutation || isRespect || isSignature || isDate ? 0 : (options.indent ?? 76);
    const lineHeight = isSalutation ? (options.salutationLineHeight ?? 76) : (options.lineHeight ?? 74);
    const lines = wrappedBlock(ctx, text, size, TEXT_W, TEXT_X, y, lineHeight, C.text, 400, indent);
    if ((isSignature || isDate) && isLetter) {
      font(ctx, size);
      for (const line of lines) line.x = W - TEXT_X - ctx.measureText(line.text).width;
    }
    // Sincerely is deliberately indented; respect stays flush left.
    if (isSincerely) lines[0].x = TEXT_X + (options.indent ?? 76);
    ops.push(...lines);
    y += lines.length * lineHeight + (isRespect || isSincerely || isSignature || isDate ? 12 : (options.paragraphSpacing ?? 38));
  }
  return {ops, bottom: y + 42};
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build the final 1440 px brand image only after explicit content approval. */
export async function renderStudent(input) {
  // Freeze an approved version before any asynchronous font/image decoding.
  const student = structuredClone(input);
  if (!canExport(student)) {
    throw new Error(exportBlockingReasons(student).join('；') || '请先确认正文和摘录。');
  }
  await Promise.all([
    document.fonts.load('36px MiSans'),
    document.fonts.load('700 98px MiSans'),
    document.fonts.ready,
  ]);
  const logoSource = `${import.meta.env?.BASE_URL || './'}assets/logo.png`;
  const [logo, ...images] = await Promise.all([
    imageFrom(logoSource, '阅星人 Logo'),
    ...student.pages.map((page, i) => imageFrom(page.dataUrl, `第 ${i + 1} 页原稿`)),
  ]);
  const measureCanvas = document.createElement('canvas');
  const measure = measureCanvas.getContext('2d');
  if (!measure) throw new Error('当前浏览器无法生成图片，请使用较新的 Chrome、Safari 或 Edge。');

  const titleOps = wrappedBlock(measure, student.title.trim(), 98, 900, OUTER, 135, 122, C.navy, 700);
  let y = 135 + titleOps.length * 122 + 22;
  const headingOps = [...titleOps];
  if (student.subtitle?.trim()) {
    const lines = wrappedBlock(measure, student.subtitle.trim(), 34, 1000, OUTER, y, 50, C.text);
    headingOps.push(...lines);
    y += lines.length * 50 + 14;
  }
  const meta = [student.name?.trim(), student.date?.trim()].filter(Boolean).join('  ·  ');
  if (meta) {
    const lines = wrappedBlock(measure, meta, 27, 1000, OUTER, y, 44, C.muted);
    headingOps.push(...lines);
    y += lines.length * 44;
  }
  const logoHeight = Math.round(logo.naturalHeight * 228 / logo.naturalWidth);
  const headerBottom = Math.max(y + 70, 78 + logoHeight + 70, 425);
  let quoteOps = [];
  let quoteY = null;
  let quoteHeight = 0;
  if (student.includeQuote && student.quote) {
    let quoteSize = 53;
    font(measure, quoteSize, 700);
    while (quoteSize > 44 && wrap(measure, student.quote, TEXT_W).length > 3) {
      quoteSize -= 3;
      font(measure, quoteSize, 700);
    }
    quoteY = headerBottom + 48;
    const lineHeight = Math.max(68, Math.round(quoteSize * 1.5));
    quoteOps = wrappedBlock(measure, student.quote, quoteSize, TEXT_W, TEXT_X, quoteY + 96, lineHeight, C.navy, 700);
    quoteHeight = Math.max(220, 96 + quoteOps.length * lineHeight + 50);
  }
  const textSectionY = quoteY === null ? headerBottom + 80 : quoteY + quoteHeight + 72;
  const panelTop = textSectionY + 104;
  const body = bodyLayout(measure, student, panelTop);
  const photoSectionY = body.bottom + 96;
  let cardY = photoSectionY + 88;
  const photoWidth = 1188;
  const photoCards = images.map((img, i) => {
    const height = Math.round(img.naturalHeight * photoWidth / img.naturalWidth);
    if (!Number.isFinite(height) || height < 1) throw new Error(`第 ${i + 1} 页原稿尺寸无效。`);
    const card = {top: cardY, height: 112 + height + 30, imageHeight: height, img};
    cardY += card.height + 42;
    return card;
  });
  const footerY = cardY - 42 + 100;
  const height = Math.ceil(footerY + 145);
  if (height > MAX_HEIGHT || W * height > MAX_PIXELS) {
    throw new Error('这篇内容超出了单张长图的尺寸限制。请选择 A4 比例自动分页，或分篇生成。');
  }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext('2d', {alpha: false});
  if (!ctx) throw new Error('图片尺寸超出了当前浏览器的内存限制，请减少原稿页数后重试。');
  ctx.fillStyle = C.surface;
  ctx.fillRect(0, 0, W, height);
  ctx.fillStyle = C.white;
  ctx.fillRect(0, 0, W, headerBottom);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(logo, W - OUTER - 228, 78, 228, logoHeight);
  paintText(ctx, headingOps);
  rule(ctx, OUTER, headerBottom - 1, W - OUTER);
  if (quoteY !== null) {
    roundRect(ctx, OUTER, quoteY, W - 2 * OUTER, quoteHeight, C.quote);
    font(ctx, 27);
    ctx.fillStyle = C.muted;
    ctx.fillText('文中摘录', TEXT_X, quoteY + 32);
    paintText(ctx, quoteOps);
  }
  section(ctx, '01', '文字整理稿', textSectionY);
  roundRect(ctx, OUTER, panelTop, W - 2 * OUTER, body.bottom - panelTop);
  paintText(ctx, body.ops);
  section(ctx, '02', '手写原稿', photoSectionY);
  for (const [index, card] of photoCards.entries()) {
    roundRect(ctx, OUTER, card.top, W - OUTER * 2, card.height);
    font(ctx, 35, 700);
    ctx.fillStyle = C.navy;
    ctx.fillText(`原稿 · 第 ${index + 1} 页`, 126, card.top + 30);
    font(ctx, 27);
    const count = `${index + 1} / ${photoCards.length}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(count, W - 126 - ctx.measureText(count).width, card.top + 35);
    rule(ctx, 126, card.top + 93, W - 126);
    ctx.drawImage(card.img, 126, card.top + 112, photoWidth, card.imageHeight);
  }
  rule(ctx, OUTER, footerY, W - OUTER);
  font(ctx, 29, 700);
  ctx.fillStyle = C.navy;
  ctx.fillText('阅星人读书社', OUTER, footerY + 39);
  // Accessing the last pixel detects unsupported/tainted canvas allocations
  // before the user reaches a download action.
  try { ctx.getImageData(W - 1, height - 1, 1, 1); }
  catch { throw new Error('当前浏览器无法处理这张长图，请减少原稿页数，或改用电脑浏览器导出。'); }
  return canvas;
}

export const A4_SIZE = Object.freeze({width: 2480, height: 3508});
const A4_H = A4_SIZE.height * W / A4_SIZE.width;
const A4_BOTTOM = A4_H - 172;
const MAX_A4_PAGES = 100;

function a4Section(ctx, label, y, compact = false) {
  font(ctx, 30);
  ctx.fillStyle = C.navy;
  ctx.fillText(label === '手写原稿' ? '02' : '01', OUTER, y + 10);
  font(ctx, 42, 700);
  ctx.fillText(label, 205, y);
  rule(ctx, 530, y + 31, compact ? W - OUTER - 210 : W - OUTER);
}

// Paginate semantic text lines, rather than cutting a long raster into slices.
// Header, excerpt and body can each continue onto another full A4 page.
function a4TextPages(ctx, student) {
  const pages = [];
  let page;
  let cursor;
  function newPage(kind = 'heading') {
    if (pages.length >= MAX_A4_PAGES) throw new Error('A4 页数过多，请把本篇内容拆成几篇后分别生成。');
    page = {ops: [], boxes: [], sections: [], headerHeight: kind === 'heading' ? A4_H : 220, first: pages.length === 0};
    pages.push(page);
    cursor = page.first ? 120 : 260;
    if (kind === 'body') {
      page.sections.push({label: '文字整理稿', y: 112, compact: true});
      page.bodyTop = 220;
      cursor = 268;
    }
  }
  function addHeading(text, size, lineHeight, color, weight = 400, width = 1000) {
    font(ctx, size, weight);
    for (const line of wrap(ctx, text, width)) {
      if (cursor + size + 20 > A4_BOTTOM) newPage('heading');
      page.ops.push({text: line, x: OUTER, y: cursor, size, weight, color});
      cursor += lineHeight;
    }
    cursor += 14;
  }
  newPage();
  addHeading(student.title.trim(), 72, 94, C.navy, 700, 900);
  if (student.subtitle?.trim()) addHeading(student.subtitle.trim(), 30, 46, C.text);
  const meta = [student.name?.trim(), student.date?.trim()].filter(Boolean).join('  ·  ');
  if (meta) addHeading(meta, 27, 42, C.muted);
  page.headerHeight = Math.max(cursor + 28, page.first ? 330 : 300);
  cursor = page.headerHeight + 38;

  if (student.includeQuote && student.quote) {
    font(ctx, 44, 700);
    const lines = wrap(ctx, student.quote, TEXT_W);
    let index = 0;
    while (index < lines.length) {
      if (cursor + 184 > A4_BOTTOM) newPage('quote');
      const capacity = Math.max(1, Math.floor((A4_BOTTOM - cursor - 118) / 66));
      const chunk = lines.slice(index, index + capacity);
      const height = 118 + chunk.length * 66;
      page.boxes.push({top: cursor, height, fill: C.quote});
      page.ops.push({text: '文中摘录', x: TEXT_X, y: cursor + 26, size: 25, weight: 400, color: C.muted});
      chunk.forEach((text, i) => page.ops.push({text, x: TEXT_X, y: cursor + 82 + i * 66, size: 44, weight: 700, color: C.navy}));
      cursor += height + 48;
      index += chunk.length;
      if (index < lines.length) newPage('quote');
    }
  }

  if (cursor + 88 + 48 + 100 > A4_BOTTOM) newPage('body');
  else {
    page.sections.push({label: '文字整理稿', y: cursor, compact: false});
    page.bodyTop = cursor + 88;
    cursor = page.bodyTop + 48;
  }
  const body = bodyLayout(ctx, student, -72, {
    bodySize: 34, salutationSize: 38, indent: 68,
    lineHeight: 58, salutationLineHeight: 66, paragraphSpacing: 24,
  });
  body.ops.forEach((op, i) => {
    if (cursor + op.size + 44 > A4_BOTTOM) newPage('body');
    page.ops.push({...op, y: cursor});
    page.bodyBottom = cursor + op.size + 44;
    const advance = body.ops[i + 1] ? body.ops[i + 1].y - op.y : 58;
    cursor += advance;
  });
  return pages;
}

function a4Canvas(logo, index, total, first = false) {
  const canvas = document.createElement('canvas');
  canvas.width = A4_SIZE.width;
  canvas.height = A4_SIZE.height;
  const ctx = canvas.getContext('2d', {alpha: false});
  if (!ctx) throw new Error('当前浏览器无法生成 A4 图片，请使用电脑浏览器重试。');
  ctx.scale(A4_SIZE.width / W, A4_SIZE.width / W);
  ctx.fillStyle = C.white;
  ctx.fillRect(0, 0, W, A4_H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const logoWidth = first ? 228 : 150;
  ctx.drawImage(logo, W - OUTER - logoWidth, 60, logoWidth, logo.naturalHeight * logoWidth / logo.naturalWidth);
  rule(ctx, OUTER, A4_H - 110, W - OUTER);
  font(ctx, 27, 700);
  ctx.fillStyle = C.navy;
  ctx.fillText('阅星人读书社', OUTER, A4_H - 76);
  font(ctx, 24);
  ctx.fillStyle = C.muted;
  const count = `${index + 1} / ${total}`;
  ctx.fillText(count, W - OUTER - ctx.measureText(count).width, A4_H - 73);
  return {canvas, ctx};
}

/** Yield one page at a time so multi-page A4 output does not retain full canvases. */
export async function* renderStudentPages(input, {format = 'long'} = {}) {
  if (format === 'long') {
    yield await renderStudent(input);
    return;
  }
  if (format !== 'a4') throw new Error('请选择长图或 A4 比例。');
  const student = structuredClone(input);
  if (!canExport(student)) throw new Error(exportBlockingReasons(student).join('；'));
  await Promise.all([document.fonts.load('34px MiSans'), document.fonts.load('700 72px MiSans'), document.fonts.ready]);
  const logo = await imageFrom(`${import.meta.env?.BASE_URL || './'}assets/logo.png`, '阅星人 Logo');
  const measureCanvas = document.createElement('canvas');
  const measure = measureCanvas.getContext('2d');
  if (!measure) throw new Error('当前浏览器无法生成 A4 图片，请使用电脑浏览器重试。');
  const plans = a4TextPages(measure, student);
  const total = plans.length + student.pages.length;
  if (total > MAX_A4_PAGES) throw new Error('A4 页数过多，请把本篇内容拆成几篇后分别生成。');
  for (const [index, plan] of plans.entries()) {
    const {canvas, ctx} = a4Canvas(logo, index, total, plan.first);
    for (const box of plan.boxes) roundRect(ctx, OUTER, box.top, W - 2 * OUTER, box.height, box.fill);
    if (plan.bodyTop !== undefined) roundRect(ctx, OUTER, plan.bodyTop, W - 2 * OUTER, plan.bodyBottom - plan.bodyTop);
    for (const s of plan.sections) a4Section(ctx, s.label, s.y, s.compact);
    paintText(ctx, plan.ops);
    yield canvas;
  }
  // Every manuscript photo gets a complete sheet. Fit within the sheet; never crop.
  for (const [index, page] of student.pages.entries()) {
    const image = await imageFrom(page.dataUrl, `第 ${index + 1} 页原稿`);
    const {canvas, ctx} = a4Canvas(logo, plans.length + index, total);
    a4Section(ctx, '手写原稿', 112, true);
    const top = 260;
    const bottom = A4_BOTTOM;
    roundRect(ctx, OUTER, top, W - OUTER * 2, bottom - top);
    font(ctx, 30, 700);
    ctx.fillStyle = C.navy;
    ctx.fillText(`原稿 · 第 ${index + 1} 页`, 130, top + 26);
    rule(ctx, 130, top + 80, W - 130);
    const maxWidth = W - 260;
    const maxHeight = bottom - top - 136;
    const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    ctx.drawImage(image, (W - width) / 2, top + 106 + (maxHeight - height) / 2, width, height);
    image.onload = null;
    image.onerror = null;
    image.removeAttribute?.('src');
    yield canvas;
  }
}

function safeStem(stem) {
  return String(stem || '阅星人学生习作').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 100) || '阅星人学生习作';
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Safari and mobile browsers may begin reading only after click returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Download the already confirmed canvas as lossless PNG or quality-95 JPG. */
export async function downloadCanvas(canvas, format, stem) {
  if (!['png', 'jpg'].includes(format)) throw new Error('请选择 PNG 或 JPG 格式。');
  const blob = await new Promise((resolve, reject) => {
    try {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('浏览器未能编码图片，请减少原稿页数后重试。')),
        format === 'jpg' ? 'image/jpeg' : 'image/png', 0.95);
    } catch {
      reject(new Error('图片下载失败，请重新生成，或改用电脑浏览器导出。'));
    }
  });
  saveBlob(blob, `${safeStem(stem)}.${format}`);
}

/** Text-only delivery has no image-generation or excerpt-confirmation step. */
export function textDownload(student) {
  if (!student?.body?.trim()) throw new Error('请先填写或识别正文。');
  const content = [student.title, [student.name, student.date].filter(Boolean).join('  '), '', student.body]
    .filter(value => value !== undefined && value !== null).join('\n');
  saveBlob(new Blob([content], {type: 'text/plain;charset=utf-8'}), `${safeStem(student.title || student.name)}.txt`);
}
