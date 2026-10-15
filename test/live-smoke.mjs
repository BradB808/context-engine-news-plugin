// Explicit opt-in only. These reads cannot create context or write to the site.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({name:'context-engine-live-review',version:'0.1.0'});
const transport = new StdioClientTransport({command:process.execPath,args:['bin/context-engine-news.mjs'],cwd:new URL('..',import.meta.url).pathname,stderr:'inherit'});
const records=[];
async function call(name,args) {
  const response=await client.callTool({name,arguments:args});
  assert.notEqual(response.isError,true,`${name}: ${response.content[0]?.text}`);
  assert.ok(response.structuredContent);
  records.push({tool:name,result:response.structuredContent});
  return response.structuredContent;
}
try {
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length,5);
  const search=await call('search_news',{query:'canada',limit:3});
  assert.ok(search.articles.length);
  await call('get_article',{article_id:search.articles[0].article_id});
  await call('latest_news',{feed:'briefing',limit:3});
  await call('latest_news',{feed:'wire',limit:3});
  const list=await call('list_threadlines',{limit:3});
  assert.ok(list.threadlines.length);
  const detail=await call('get_threadline',{slug:list.threadlines[0].slug});
  assert.ok(detail.articles.length);
  if(detail.next_offset!==null) await call('get_threadline',{slug:list.threadlines[0].slug,offset:detail.next_offset});
  await mkdir(new URL('../review/',import.meta.url),{recursive:true});
  await writeFile(new URL('../review/live-results.json',import.meta.url),JSON.stringify({checked_at:new Date().toISOString(),records},null,2));
  for(const record of records) console.log(`${record.tool}: OK (${record.result.articles?.length ?? record.result.threadlines?.length ?? 1} results), edition ${record.result.published_feed_at}`);
} finally { await client.close(); }
