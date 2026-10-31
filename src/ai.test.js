import test from 'node:test';
import assert from 'node:assert/strict';
import {recognizeWriting} from './ai.js';

const pages = [{dataUrl:'data:image/jpeg;base64,YQ=='}];
const settings = {provider:'openai',baseUrl:'https://example.test/v1',apiKey:'test-only',model:'vision-test'};
const output = {name:'',title:'',date:'',body:'春天来了。\n花开了。',quote:'春天来了。',uncertainties:[]};
function mock(body, status = 200) { return async () => new Response(JSON.stringify(body), {status,headers:{'content-type':'application/json'}}); }
function run(fn) { return test(fn.name, {concurrency:false}, fn); }
run(async function openaiPreservesImageOrderAndDoesNotAutoConfirm() {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url,'https://example.test/v1/chat/completions');
    assert.equal(init.headers.Authorization,'Bearer test-only');
    const payload = JSON.parse(init.body);
    assert.equal(payload.messages[1].content[1].image_url.url,pages[0].dataUrl);
    assert.equal(payload.response_format.type,'json_object');
    assert.equal(init.redirect,'error');
    return new Response(JSON.stringify({choices:[{message:{content:'```json\n'+JSON.stringify(output)+'\n```'}}]}));
  };
  try { assert.deepEqual(await recognizeWriting({pages,settings}),output); }
  finally {globalThis.fetch=original;}
});
run(async function geminiUsesHeaderAndInlineImages() {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
    assert.equal(init.headers['x-goog-api-key'],'test-only');
    assert.ok(!url.includes('test-only'));
    const payload=JSON.parse(init.body);
    assert.equal(payload.contents[0].parts[1].inlineData.mimeType,'image/jpeg');
    assert.equal(payload.contents[0].parts[1].inlineData.data,'YQ==');
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(output)}]}}]}));
  };
  try { assert.deepEqual(await recognizeWriting({pages,settings:{...settings,provider:'gemini',baseUrl:'',model:'gemini-test'}}),output); }
  finally {globalThis.fetch=original;}
});
run(async function rejectsUnsafeEndpointsBeforeSendingCredentials() {
  const original = globalThis.fetch;
  globalThis.fetch = () => {throw new Error('Must not fetch');};
  try {
    for(const baseUrl of ['http://example.test/v1','https://user:password@example.test/v1','https://example.test/v1?key=oops','https://example.test/v1#fragment']) {
      await assert.rejects(recognizeWriting({pages,settings:{...settings,baseUrl}}),/HTTPS/);
    }
  } finally {globalThis.fetch=original;}
});
run(async function rejectsInventedOrPartialQuoteAndPreservesUncertainty() {
  const original=globalThis.fetch;
  try {
    globalThis.fetch=mock({choices:[{message:{content:JSON.stringify({...output,body:'春天【待确认】。',quote:'春天真美。'})}}]});
    const result=await recognizeWriting({pages,settings});
    assert.equal(result.quote,'');
    assert.equal(result.name,'');
    assert.equal(result.uncertainties.length,1);
    globalThis.fetch=mock({choices:[{message:{content:JSON.stringify({...output,quote:'天来了。'})}}]});
    assert.equal((await recognizeWriting({pages,settings})).quote,'');
  } finally {globalThis.fetch=original;}
});
run(async function statusAndNetworkErrorsAreUsefulAndDoNotExposeProviderContent() {
  const original=globalThis.fetch;
  try {
    globalThis.fetch=mock({error:{message:'private essay and test-only'}},401);
    await assert.rejects(recognizeWriting({pages,settings}),e=>e.message.includes('鉴权')&&!e.message.includes('test-only'));
    globalThis.fetch=async()=>{throw new TypeError('private detail');};
    await assert.rejects(recognizeWriting({pages,settings}),e=>e.message.includes('CORS')&&!e.message.includes('private'));
  } finally {globalThis.fetch=original;}
});
run(async function acceptsRootAndFullOpenaiUrlsWithoutDuplicatingPaths() {
  const original=globalThis.fetch;
  try {
    for(const [baseUrl, expected] of [['https://example.test','https://example.test/v1/chat/completions'],['https://example.test/api/v1','https://example.test/api/v1/chat/completions'],['https://example.test/v1/chat/completions/','https://example.test/v1/chat/completions']]) {
      globalThis.fetch=async(url)=>{assert.equal(url,expected);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}));};
      await recognizeWriting({pages,settings:{...settings,baseUrl}});
    }
  } finally {globalThis.fetch=original;}
});
