const DATABASE = 'yuexingren-writing-workbench';
const STORE = 'state';
const KEY = 'workspace';
let opening = null;

function storageError(error, action = '保存') {
  if (error?.name === 'QuotaExceededError') {
    return new Error('浏览器存储空间不足，草稿未保存。请下载已完成的图片，并删除不需要的草稿后重试。');
  }
  return new Error(`${action}本机草稿失败。请检查浏览器是否允许此网站使用本地存储；无痕模式可能限制存储。`);
}

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(storageError(null, '读取'));
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    let settled = false;
    let request;
    try { request = indexedDB.open(DATABASE, 1); }
    catch (error) { reject(storageError(error, '打开')); return; }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onerror = () => {
      settled = true;
      reject(storageError(request.error, '打开'));
    };
    request.onblocked = () => {
      settled = true;
      reject(new Error('本机草稿正被其他页面占用，请关闭这个工作台的其他标签页后重试。'));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      settled = true;
      db.onversionchange = () => { db.close(); opening = null; };
      db.onclose = () => { opening = null; };
      resolve(db);
    };
  }).catch(error => { opening = null; throw error; });
  return opening;
}

// Persist manuscript data only. Provider settings and API credentials never
// enter this store, even if a caller accidentally adds a settings property.
function copyStudents(students) {
  if (!Array.isArray(students)) throw new Error('草稿格式不正确，无法保存。');
  const text = (value) => typeof value === 'string' ? value : '';
  return students.map(student => {
    if (!student || typeof student !== 'object' || !Array.isArray(student.pages) || !Array.isArray(student.uncertainties)) {
      throw new Error('草稿格式不正确，无法保存。');
    }
    return {
      id: text(student.id), name: text(student.name), title: text(student.title),
      subtitle: text(student.subtitle), date: text(student.date), body: text(student.body),
      quote: text(student.quote), includeQuote: Boolean(student.includeQuote),
      bodyConfirmed: Boolean(student.bodyConfirmed), quoteConfirmed: Boolean(student.quoteConfirmed),
      uncertainties: student.uncertainties.filter(item => typeof item === 'string'),
      pages: student.pages.map(page => {
        if (!page || typeof page !== 'object') throw new Error('原稿页面格式不正确，无法保存。');
        return {
          id: text(page.id), name: text(page.name), dataUrl: text(page.dataUrl),
          width: Number(page.width) || 0, height: Number(page.height) || 0,
        };
      }),
    };
  });
}

/** Read the current device's manuscript workspace; null means no saved draft. */
export async function loadWorkspace() {
  const db = await openDatabase();
  const raw = await new Promise((resolve, reject) => {
    let transaction;
    try { transaction = db.transaction(STORE, 'readonly'); }
    catch (error) { reject(storageError(error, '读取')); return; }
    const request = transaction.objectStore(STORE).get(KEY);
    let value;
    request.onsuccess = () => { value = request.result; };
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => reject(storageError(transaction.error, '读取'));
    transaction.onabort = () => reject(storageError(transaction.error, '读取'));
  });
  if (raw === undefined || raw === null) return null;
  try { return copyStudents(JSON.parse(raw)); }
  catch { throw new Error('本机草稿数据无法读取，请清除本机草稿后重新开始。'); }
}

/** Save only manuscript records and original image data URLs on this device. */
export async function saveWorkspace(students) {
  let serialized;
  try { serialized = JSON.stringify(copyStudents(students)); }
  catch (error) { throw error instanceof Error ? error : storageError(error); }
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(serialized, KEY);
    } catch (error) { reject(storageError(error)); return; }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(storageError(transaction.error));
    transaction.onabort = () => reject(storageError(transaction.error));
  });
}

/** Delete manuscript drafts without touching the user's separate settings. */
export async function clearWorkspace() {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).delete(KEY);
    } catch (error) { reject(storageError(error, '清除')); return; }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(storageError(transaction.error, '清除'));
    transaction.onabort = () => reject(storageError(transaction.error, '清除'));
  });
}
