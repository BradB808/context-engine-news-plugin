import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer } from '../src/server.mjs';
import { createHttpApp } from '../src/http.mjs';
import { createNewsClient } from '../src/client.mjs';
import { NOW, row, topic, fixtureFetch } from './fixtures.mjs';

async function pair() {
  const calls=[], news=createNewsClient({fetchImpl:fixtureFetch(calls),now:()=>NOW});
  const server=createServer(news), client=new Client({name:'connector-offline-test',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  return {client,server,calls};
}

test('real SDK handshake discovers only the five read-only tools',async()=>{
  const {client,server,calls}=await pair();
  try {
    const list=await client.listTools();
    assert.deepEqual(list.tools.map(t=>t.name),['search_news','latest_news','get_article','list_threadlines','get_threadline']);
    for(const tool of list.tools) {
      assert.equal(tool.annotations.readOnlyHint,true); assert.equal(tool.annotations.destructiveHint,false);
      assert.equal(tool.inputSchema.additionalProperties,false);
    }
    assert.equal(calls.length,0);
    assert.equal(client.getServerVersion().name,'context-engine-news');
    assert.match(client.getInstructions(),/never AI context/);
  } finally {await client.close();await server.close();}
});

test('real MCP tools return usable structured results without context or body fields',async()=>{
  const {client,server}=await pair();
  try {
    for(const [name,args] of [
      ['search_news',{query:'trade'}],['latest_news',{}],['get_article',{article_id:row.guardian_id}],
      ['list_threadlines',{}],['get_threadline',{slug:topic.slug}],
    ]) {
      const result=await client.callTool({name,arguments:args});
      assert.notEqual(result.isError,true,JSON.stringify(result));
      assert.equal(result.structuredContent.provider,'Context Engine News');
      assert.deepEqual(JSON.parse(result.content[0].text),result.structuredContent);
      assert.ok(!JSON.stringify(result).includes('MUST NOT LEAK'));
    }
  } finally {await client.close();await server.close();}
});

test('unknown/generation tools and extra URL arguments cannot reach the network',async()=>{
  const {client,server,calls}=await pair();
  try {
    for(const name of ['generate_context','generate-context','translate_article','fetch','createMessage','get_context']) {
      const result=await client.callTool({name,arguments:{}});
      assert.equal(result.isError,true);
    }
    for(const [name,args] of [
      ['search_news',{query:'trade',url:'https://evil.example'}],['search_news',{query:'a'}],
      ['latest_news',{limit:1000}],['get_threadline',{slug:'../generate-context'}],
      ['get_article',{article_id:'https://thecontextengine.ca/api/generate-context'}],
    ]) {
      const result=await client.callTool({name,arguments:args}); assert.equal(result.isError,true);
    }
    assert.equal(calls.length,0);
  } finally {await client.close();await server.close();}
});

test('stdio process initializes and lists tools with clean protocol stdout',async()=>{
  const client=new Client({name:'stdio-test',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:['src/stdio.mjs'],cwd:new URL('..',import.meta.url).pathname,stderr:'pipe'});
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length,5);
  } finally {await client.close();}
});

test('Streamable HTTP connects with the official SDK and calls a tool',async()=>{
  const app=createHttpApp(createNewsClient({fetchImpl:fixtureFetch(),now:()=>NOW}));
  app.listen(0,'127.0.0.1');await once(app,'listening');
  const endpoint=new URL(`http://127.0.0.1:${app.address().port}/mcp`);
  const client=new Client({name:'http-test',version:'1'});
  try {
    await client.connect(new StreamableHTTPClientTransport(endpoint));
    assert.equal((await client.listTools()).tools.length,5);
    const result=await client.callTool({name:'search_news',arguments:{query:'trade'}});
    assert.equal(result.structuredContent.articles[0].title,row.title);
    assert.equal((await fetch(endpoint)).status,405);
    assert.equal((await fetch(endpoint,{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,403);
    // Node fetch normalizes Host; use a raw HTTP client to exercise DNS-rebinding protection.
    const hostStatus = await new Promise((resolve,reject) => {
      const req=httpRequest(endpoint,{method:'POST',headers:{Host:'evil.example','Content-Type':'application/json'}},res=>{res.resume();resolve(res.statusCode);});
      req.on('error',reject);req.end('{}');
    });
    assert.equal(hostStatus,403);
    assert.equal((await fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
    assert.equal((await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(17000)})).status,413);
  } finally {await client.close(); app.closeAllConnections(); await new Promise(resolve=>app.close(resolve));}
});
