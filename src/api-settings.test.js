import test from 'node:test';
import assert from 'node:assert/strict';
import {API_PRESETS, loadApiSettings, saveApiSettings, forgetApiKey} from './api-settings.js';

const PREFS = 'yxr-api-preferences';
const SECRET = 'yxr-api-secret';
const TEST_KEY = 'test-only-local-secret';
const configured = {provider:'deepseek', ...API_PRESETS.deepseek, apiKey:TEST_KEY, rememberApiKey:true};

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const operations = [];
  return {
    data, operations,
    getItem(key) { operations.push(['get', key]); return data.get(key) ?? null; },
    setItem(key, value) { operations.push(['set', key]); data.set(key, String(value)); },
    removeItem(key) { operations.push(['remove', key]); data.delete(key); },
  };
}

function withStorage(fn) {
  return async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const storage = memoryStorage();
    Object.defineProperty(globalThis, 'localStorage', {value:storage, configurable:true});
    try { await fn(storage); }
    finally {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else delete globalThis.localStorage;
    }
  };
}

test('defaults do not remember a key and presets match the current providers', withStorage(storage => {
  assert.deepEqual(loadApiSettings(), {provider:'openai', ...API_PRESETS.openai, apiKey:'', rememberApiKey:false});
  assert.equal(API_PRESETS.deepseek.model, 'deepseek-flash');
  assert.equal(API_PRESETS.deepseek.baseUrl, 'https://api.deepseek.com');
  saveApiSettings({...configured, rememberApiKey:false, extra:'ignored'});
  assert.equal(storage.data.has(SECRET), false);
  const prefs = JSON.parse(storage.data.get(PREFS));
  assert.equal(prefs.apiKey, undefined);
  assert.equal(prefs.extra, undefined);
  assert.equal(loadApiSettings().apiKey, '');
}));

test('explicit opt-in restores after reload without storing secrets in preferences', withStorage(storage => {
  const saved = saveApiSettings(configured);
  assert.deepEqual(saved, configured);
  assert.deepEqual(loadApiSettings(), configured);
  assert.ok(!storage.data.get(PREFS).includes(TEST_KEY));
  assert.deepEqual(JSON.parse(storage.data.get(SECRET)), {
    provider:'deepseek', baseUrl:API_PRESETS.deepseek.baseUrl, apiKey:TEST_KEY,
  });
  assert.deepEqual(storage.operations.slice(0, 3), [['remove', SECRET], ['set', PREFS], ['set', SECRET]]);
}));

test('disabling opt-in deletes a previously remembered secret', withStorage(storage => {
  saveApiSettings(configured);
  const saved = saveApiSettings({...configured, rememberApiKey:false});
  assert.equal(saved.apiKey, TEST_KEY); // May still be used in this page's memory.
  assert.equal(storage.data.has(SECRET), false);
  assert.equal(loadApiSettings().rememberApiKey, false);
  assert.equal(loadApiSettings().apiKey, '');
}));

test('forget clears the secret and opt-in while retaining API preferences', withStorage(storage => {
  saveApiSettings({...configured, baseUrl:'https://proxy.example.test/v1/', model:'my-vision-model'});
  const result = forgetApiKey();
  assert.deepEqual(result, {provider:'deepseek', baseUrl:'https://proxy.example.test/v1', model:'my-vision-model', apiKey:'', rememberApiKey:false});
  assert.equal(storage.data.has(SECRET), false);
  assert.deepEqual(loadApiSettings(), result);
}));

test('keys never restore across a changed provider or API endpoint', withStorage(storage => {
  saveApiSettings(configured);
  for (const patch of [
    {provider:'gemini'},
    {baseUrl:'https://other.example.test'},
    {baseUrl:'https://api.deepseek.com/v1'},
    {rememberApiKey:'true'},
  ]) {
    storage.data.set(PREFS, JSON.stringify({...configured, ...patch}));
    const loaded = loadApiSettings();
    assert.equal(loaded.apiKey, '');
    assert.equal(loaded.rememberApiKey, false);
  }
}));

test('equivalent origin spelling and trailing slashes allow the matching secret', withStorage(storage => {
  saveApiSettings(configured);
  storage.data.set(PREFS, JSON.stringify({...configured, baseUrl:'https://API.DEEPSEEK.COM:443///'}));
  assert.equal(loadApiSettings().apiKey, TEST_KEY);
  assert.equal(loadApiSettings().baseUrl, 'https://api.deepseek.com');
}));

test('unknown providers fall back to OpenAI without restoring any remembered key', withStorage(storage => {
  saveApiSettings(configured);
  storage.data.set(PREFS, JSON.stringify({...configured, provider:'future-provider'}));
  assert.deepEqual(loadApiSettings(), {provider:'openai', ...API_PRESETS.openai, apiKey:'', rememberApiKey:false});
}));

test('legacy inline keys are ignored while provider, endpoint and model migrate', withStorage(storage => {
  storage.data.set(PREFS, JSON.stringify({provider:'gemini', baseUrl:'https://gemini.example.test/v1beta/', model:'vision-custom', apiKey:TEST_KEY}));
  assert.deepEqual(loadApiSettings(), {provider:'gemini', baseUrl:'https://gemini.example.test/v1beta', model:'vision-custom', apiKey:'', rememberApiKey:false});
  storage.data.set(PREFS, JSON.stringify({baseUrl:'https://old.example.test/v1', model:'old-model', apiKey:TEST_KEY}));
  assert.equal(loadApiSettings().provider, 'openai');
  assert.equal(loadApiSettings().model, 'old-model');
  assert.equal(loadApiSettings().apiKey, '');
}));

test('incomplete, malformed or unmatched secret records do not restore', withStorage(storage => {
  saveApiSettings(configured);
  for (const secret of ['not json', 'null', JSON.stringify({provider:'deepseek',apiKey:TEST_KEY}), JSON.stringify({provider:'deepseek',baseUrl:'https://api.deepseek.com',apiKey:''})]) {
    storage.data.set(SECRET, secret);
    assert.equal(loadApiSettings().apiKey, '');
  }
  storage.data.set(PREFS, JSON.stringify({...configured, baseUrl:undefined}));
  storage.data.set(SECRET, JSON.stringify({provider:'deepseek',baseUrl:'https://api.deepseek.com',apiKey:TEST_KEY}));
  assert.equal(loadApiSettings().apiKey, '');
}));

test('blocked storage reads return defaults and write failures do not expose secrets', withStorage(storage => {
  Object.defineProperty(globalThis, 'localStorage', {configurable:true,get() {throw new Error(TEST_KEY);}});
  assert.equal(loadApiSettings().provider, 'openai');
  assert.equal(loadApiSettings().apiKey, '');
  assert.throws(() => saveApiSettings(configured), error => error.message.includes('保存 API 设置失败') && !error.message.includes(TEST_KEY));
  assert.throws(() => forgetApiKey(), error => error.message.includes('清除已记住') && !error.message.includes(TEST_KEY));
}));

test('failed preference writes revoke the old secret before changing settings', withStorage(storage => {
  saveApiSettings(configured);
  storage.setItem = () => {throw new Error(TEST_KEY);};
  assert.throws(() => saveApiSettings({...configured, baseUrl:'https://new.example.test/v1'}), /保存 API 设置失败/);
  assert.equal(storage.data.has(SECRET), false);
  assert.equal(loadApiSettings().apiKey, '');
}));

test('failed secret persistence throws and cannot appear restored on reload', withStorage(storage => {
  const originalSet = storage.setItem.bind(storage);
  storage.setItem = (key,value) => {
    if (key === SECRET) throw new Error(TEST_KEY);
    originalSet(key,value);
  };
  assert.throws(() => saveApiSettings(configured), error => error.message.includes('保存 API 设置失败') && !error.message.includes(TEST_KEY));
  assert.equal(loadApiSettings().apiKey, '');
  assert.equal(loadApiSettings().rememberApiKey, false);
}));

test('secret removal failures throw instead of reporting save or clear success', withStorage(storage => {
  saveApiSettings(configured);
  storage.removeItem = () => {throw new Error(TEST_KEY);};
  assert.throws(() => saveApiSettings({...configured,rememberApiKey:false}), /保存 API 设置失败/);
  assert.throws(() => forgetApiKey(), error => error.message.includes('清除已记住') && !error.message.includes(TEST_KEY));
  assert.equal(storage.data.has(SECRET), true);
}));

test('forget reports preference-write failures even after the secret was removed', withStorage(storage => {
  saveApiSettings(configured);
  storage.setItem = () => {throw new Error(TEST_KEY);};
  assert.throws(() => forgetApiKey(), /清除已记住的 API 密钥失败/);
  assert.equal(storage.data.has(SECRET), false);
}));
