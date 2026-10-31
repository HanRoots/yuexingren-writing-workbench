/** Browser-local API preferences. Secrets never enter the preference record. */
export const API_PRESETS = Object.freeze({
  openai: Object.freeze({baseUrl:'https://api.openai.com/v1', model:''}),
  gemini: Object.freeze({baseUrl:'https://generativelanguage.googleapis.com/v1beta', model:''}),
  deepseek: Object.freeze({baseUrl:'https://api.deepseek.com', model:'deepseek-flash'}),
});

const PREFERENCES_KEY = 'yxr-api-preferences';
const SECRET_KEY = 'yxr-api-secret';

function defaults() {
  return {provider:'openai', ...API_PRESETS.openai, apiKey:'', rememberApiKey:false};
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readRecord(storage, key) {
  const value = storage.getItem(key);
  if (!value) return null;
  // A malformed record is ignored; a failed storage read still reaches the
  // caller so clear/save never report success after a storage exception.
  try {
    const record = JSON.parse(value);
    return isRecord(record) ? record : null;
  } catch { return null; }
}

function normalizeEndpoint(value) {
  const url = new URL(value.trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
      || url.username || url.password || url.search || url.hash) throw new Error();
  // Keep distinct API paths distinct. Only spelling differences that do not
  // change the selected origin/path, including trailing slashes, are folded.
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function preferencesFrom(record) {
  if (!isRecord(record) || !Object.hasOwn(API_PRESETS, record.provider)) return null;
  const provider = record.provider;
  let baseUrl;
  try {
    baseUrl = normalizeEndpoint(typeof record.baseUrl === 'string' && record.baseUrl.trim()
      ? record.baseUrl : API_PRESETS[provider].baseUrl);
  } catch { return null; }
  return {
    provider,
    baseUrl,
    model:typeof record.model === 'string' ? record.model.trim() : API_PRESETS[provider].model,
    rememberApiKey:record.rememberApiKey === true,
  };
}

/** Restore a secret only after an explicit, matching on-device opt-in. */
export function loadApiSettings() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return defaults();
    const record = readRecord(storage, PREFERENCES_KEY);
    // Old records without provider use the historic OpenAI default. An
    // explicitly unknown provider is not allowed to inherit a remembered key.
    const legacy = isRecord(record) && record.provider === undefined
      ? {...record, provider:'openai'} : record;
    const preferences = preferencesFrom(legacy);
    if (!preferences) return defaults();
    const settings = {...preferences, apiKey:'', rememberApiKey:false};
    if (!preferences.rememberApiKey || record?.provider !== preferences.provider
        || typeof record.baseUrl !== 'string' || !record.baseUrl.trim()) return settings;
    const secret = readRecord(storage, SECRET_KEY);
    if (!secret || secret.provider !== preferences.provider || typeof secret.baseUrl !== 'string'
        || typeof secret.apiKey !== 'string' || !secret.apiKey.trim()) return settings;
    let secretEndpoint;
    try { secretEndpoint = normalizeEndpoint(secret.baseUrl); }
    catch { return settings; }
    if (secretEndpoint !== preferences.baseUrl) return settings;
    return {...settings, apiKey:secret.apiKey.trim(), rememberApiKey:true};
  } catch { return defaults(); }
}

/** Save allowlisted preferences; an opted-in secret is a separate record. */
export function saveApiSettings(settings) {
  const preferences = preferencesFrom(settings);
  if (!preferences) throw new Error('API 设置格式不正确，请检查接口类型和 API 地址。');
  const apiKey = typeof settings.apiKey === 'string' ? settings.apiKey.trim() : '';
  if (preferences.rememberApiKey && !apiKey) throw new Error('请先填写需要在本机记住的 API 密钥。');
  try {
    const storage = globalThis.localStorage;
    if (!storage) throw new Error();
    // Revoke the previous secret before changing endpoint/provider metadata.
    // Any later write failure leaves no old key that could be reused wrongly.
    storage.removeItem(SECRET_KEY);
    storage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    if (preferences.rememberApiKey) {
      storage.setItem(SECRET_KEY, JSON.stringify({
        provider:preferences.provider, baseUrl:preferences.baseUrl, apiKey,
      }));
    }
  } catch {
    throw new Error('保存 API 设置失败，请检查浏览器本机存储权限或空间后重试。');
  }
  return {...preferences, apiKey};
}

/** Clear the remembered key while preserving provider, address and model. */
export function forgetApiKey() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) throw new Error();
    storage.removeItem(SECRET_KEY);
    const record = readRecord(storage, PREFERENCES_KEY);
    const legacy = isRecord(record) && record.provider === undefined
      ? {...record, provider:'openai'} : record;
    const preferences = preferencesFrom(legacy) || {
      provider:'openai', ...API_PRESETS.openai, rememberApiKey:false,
    };
    const next = {...preferences, rememberApiKey:false};
    storage.setItem(PREFERENCES_KEY, JSON.stringify(next));
    return {...next, apiKey:''};
  } catch {
    throw new Error('清除已记住的 API 密钥失败，请检查浏览器本机存储权限后重试。');
  }
}
