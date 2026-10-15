import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createNewsClient, validId } from '../src/client.mjs';
import { NOW, row, member, topic, fixtureFetch } from './fixtures.mjs';

const make = (fetchImpl = fixtureFetch(), extra = {}) => createNewsClient({ fetchImpl, now: () => NOW, ...extra });

test('all tools use only fixed-origin GETs to published metadata endpoints', async () => {
  const calls = [], client = make(fixtureFetch(calls));
  const results = await Promise.all([
    client.searchNews({query:'canada',limit:3}), client.latestNews(), client.latestNews({feed:'wire'}),
    client.getArticle({article_id:row.guardian_id}),
  ]);
  results.push(await client.listThreadlines(), await client.getThreadline({slug:topic.slug}));
  assert.equal(calls.length, 6);
  for (const {url: raw, init} of calls) {
    const url = new URL(raw);
    assert.equal(url.origin, 'https://thecontextengine.ca');
    assert.ok(['/api/published-reading','/api/topics'].includes(url.pathname));
    assert.notEqual(url.searchParams.get('kind'), 'context');
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    assert.deepEqual(Object.keys(init.headers).sort(), ['Accept','User-Agent']);
  }
  const text = JSON.stringify(results);
  for (const secret of ['FULL ARTICLE', 'SAVED AI CONTEXT', 'PRIVATE DATA', 'body_blocks', 'contexts']) assert.ok(!text.includes(secret), secret);
  assert.match(results[0].articles[0].url, /\/briefing\/curated%2F/);
  assert.equal(results[0].articles[0].source_url, row.web_url);
  assert.equal(results[4].threadlines[0].url, 'https://thecontextengine.ca/themes/trade-tariffs');
});

test('search input is encoded as data and never changes destination or dispatch', async () => {
  const calls = [], client = make(fixtureFetch(calls));
  const query = 'trade&kind=context&url=https://evil.example/generate-context';
  await client.searchNews({query});
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('q'), query); assert.equal(url.searchParams.getAll('kind').length,1);
  assert.equal(url.searchParams.get('kind'),'search');
});

test('invalid queries, ids, pages and limits fail before any network request', async () => {
  let count = 0; const client = make(() => {count++; throw new Error('NETWORK SHOULD NOT RUN');});
  const invalid = [undefined, null, {}, [], 5, true, '\nhello', 'a', 'a'.repeat(201)];
  for (const query of invalid) await assert.rejects(client.searchNews({query}));
  for (const limit of [0,-1,21,1.5,'10',Infinity,NaN]) await assert.rejects(client.latestNews({limit}));
  for (const id of ['https://evil.example', '../generate-context','/api/context','id?kind=context','a%2Fb','a\\b','x\n']) {
    assert.equal(validId(id),false); await assert.rejects(client.getArticle({article_id:id}));
  }
  for (const slug of ['../x','https://evil.example','a?kind=context','UPPER','a'.repeat(91)]) await assert.rejects(client.getThreadline({slug}));
  for (const offset of [-1,1,24.5,3264,'24']) await assert.rejects(client.getThreadline({slug:topic.slug,offset}));
  await assert.rejects(client.latestNews({feed:'wire',region:'ca'}));
  await assert.rejects(client.latestNews({region:'unknown'}));
  assert.equal(count,0);
});

test('uses different canonical routes for Guardian, curated and market members', async () => {
  const articles = [member,{...member,id:'world/2026/oct/14/story'},{...member,id:'market/rss/wsj/2026-10-14/story'}];
  const client = make(async () => Response.json({topic,articles,contexts:[],nextOffset:null,fetchedAt:NOW}));
  const result = await client.getThreadline({slug:topic.slug});
  assert.match(result.articles[0].url,/\/briefing\/curated%2F/);
  assert.match(result.articles[1].url,/\/dossier\/world%2F/);
  assert.equal(result.articles[2].url,'https://thecontextengine.ca/market-news/rss%2Fwsj%2F2026-10-14%2Fstory');
});

test('Threadline filtering and pagination preserve real member metadata', async () => {
  const client = make();
  assert.equal((await client.listThreadlines({query:'TRADE'})).threadlines.length,1);
  assert.equal((await client.listThreadlines({query:'nothing'})).threadlines.length,0);
  const first = await client.getThreadline({slug:topic.slug});
  assert.equal(first.next_offset,24);
  assert.equal((await client.getThreadline({slug:topic.slug,offset:first.next_offset})).next_offset,null);
});

test('publisher excerpts remove tracking and headline-only boilerplate without inventing content', async () => {
  const input = [
    {...row, trail_text:'{beacon} Energy & Environment Energy & Environment The Big Story Rates and trade A short publisher excerpt.'},
    {...row, trail_text:'The post Rates and trade appeared first on Example News.'},
    {...row, trail_text:'Rates and trade.'},
    {...row, trail_text:'A substantive excerpt. The post Rates and trade appeared first on Example News.'},
    {...row, trail_text:'The article explains how a {beacon} token works.'},
  ];
  const result = await make(async()=>Response.json({data:input,fetchedAt:NOW})).latestNews();
  assert.equal(result.articles[0].summary,'Rates and trade A short publisher excerpt.');
  assert.equal(result.articles[1].summary,'');assert.equal(result.articles[1].summary_available,false);
  assert.equal(result.articles[2].summary,'');assert.equal(result.articles[2].summary_available,false);
  assert.equal(result.articles[3].summary,'A substantive excerpt.');
  assert.equal(result.articles[4].summary,'The article explains how a {beacon} token works.');
  assert.equal(result.articles[0].title,row.title);assert.equal(result.articles[0].source_url,row.web_url);
});

test('coverage bounds and requested topic-result bounds are reported separately', async () => {
  const topics=[topic,{...topic,slug:'interest-rates',label:'Interest rates'}];
  const result=await make(async()=>Response.json({topics,featured:[],limited:false,fetchedAt:NOW})).listThreadlines({limit:1});
  assert.equal(result.limited,false);assert.equal(result.coverage_limited,false);
  assert.equal(result.returned_threadlines,1);assert.equal(result.matching_threadlines,2);
  assert.equal(result.more_matching_threadlines,true);
});

test('cache shares requests, expires, and does not return mutable shared objects', async () => {
  let now = NOW; const calls = [], client = make(fixtureFetch(calls),{now:()=>now});
  const results = await Promise.all(Array.from({length:8},()=>client.searchNews({query:'canada'})));
  assert.equal(calls.length,1);
  results[0].articles[0].title = 'changed';
  assert.equal(results[1].articles[0].title,row.title);
  assert.equal((await client.searchNews({query:'canada'})).articles[0].title,row.title);
  now += 30_001;
  await client.searchNews({query:'canada'}); assert.equal(calls.length,2);
});

test('fetch failures are not cached and never trigger another endpoint', async () => {
  let count = 0; const mock = fixtureFetch();
  const client = make(async (...args) => { if (++count === 1) throw new Error('SECRET ERROR'); return mock(...args); });
  await assert.rejects(client.searchNews({query:'canada'}), error => !error.message.includes('SECRET'));
  assert.equal((await client.searchNews({query:'canada'})).articles.length,1);
  assert.equal(count,2);
});

for (const status of [301,302,401,403,404,429,500,503]) test(`HTTP ${status} fails without generation or redirect`, async () => {
  let count=0;
  const client = make(async () => {count++; return new Response('untrusted error',{status,headers:{location:'https://evil.example'}});});
  await assert.rejects(client.latestNews()); assert.equal(count,1);
});

test('rejects redirected or non-JSON feed responses', async () => {
  for (const response of [new Response('<html>bad</html>'),{...Response.json({}),redirected:true,url:'https://evil.example'}]) {
    await assert.rejects(make(async()=>response).latestNews());
  }
});

test('rejects oversized content-length and chunked bodies', async () => {
  for (const response of [
    new Response('{}',{headers:{'content-type':'application/json','content-length':'600000'}}),
    new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(600000));controller.close();}}),{headers:{'content-type':'application/json'}}),
  ]) await assert.rejects(make(async()=>response).latestNews(),/too large/);
});

test('aborts timed-out requests and surfaces a safe error', async () => {
  const client = make((url,{signal}) => new Promise((resolve,reject) => signal.addEventListener('abort',()=>reject(new Error('timeout')))),{timeoutMs:10});
  await assert.rejects(client.latestNews(),/Could not read/);
});

test('rejects malformed, future, expired and mismatched published records', async () => {
  const values = [null,[],{}, {data:[],fetchedAt:NOW+120000}, {data:[],fetchedAt:NOW-72*3600000},
    {data:[{...row,web_url:'javascript:alert(1)'}],fetchedAt:NOW},
    {data:[{...row,web_publication_date:'no date'}],fetchedAt:NOW},
    {data:[{...row,guardian_id:'https://evil.example'}],fetchedAt:NOW}];
  for (const value of values) await assert.rejects(make(async()=>Response.json(value)).latestNews());
  await assert.rejects(make(async()=>Response.json({data:row,fetchedAt:NOW})).getArticle({article_id:'different-id'}));
  await assert.rejects(make(async()=>Response.json({topic,articles:[member],nextOffset:999,fetchedAt:NOW})).getThreadline({slug:topic.slug}));
});

test('reports stale and limited coverage without claiming completeness', async () => {
  const client = make(async()=>Response.json({topics:[topic],featured:[],limited:true,fetchedAt:NOW-31*60000}));
  const result = await client.listThreadlines();
  assert.equal(result.stale,true); assert.equal(result.limited,true); assert.match(result.coverage,/not a complete/);
});

test('bounds upstream traffic and refuses excessive concurrent requests', async () => {
  const client = make();
  for(let i=0;i<60;i++) await client.searchNews({query:`query ${i}`});
  await assert.rejects(client.searchNews({query:'one more'}),/request limit/);
  const waiting=[];
  const slow = make((...args)=>new Promise(resolve=>waiting.push(()=>fixtureFetch()(...args).then(resolve))));
  const active=Array.from({length:4},(_,i)=>slow.searchNews({query:`slow ${i}`}));
  await assert.rejects(slow.searchNews({query:'fifth'}),/request limit/);
  for(const resolve of waiting) resolve();
  await Promise.all(active);
});

test('runtime import boundary contains no website or model SDK imports', async () => {
  const files = (await readdir(new URL('../src/',import.meta.url))).filter(name=>name.endsWith('.mjs'));
  for (const file of files) {
    const text = await readFile(new URL(`../src/${file}`,import.meta.url),'utf8');
    const imports = [...text.matchAll(/from ['"]([^'"]+)['"]/g)].map(match=>match[1]);
    for(const dependency of imports) assert.ok(dependency.startsWith('./') || dependency.startsWith('node:') || dependency.startsWith('@modelcontextprotocol/sdk/') || dependency==='zod', `${file}: ${dependency}`);
    assert.ok(!/process\.env\.(?:GEMINI|GOOGLE|SUPABASE)|generativelanguage|functions\/v1|sampling\/createMessage/.test(text),file);
  }
});
