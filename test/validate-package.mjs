import { readFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ajv=new Ajv2020({strict:true});
for(const [file,schema] of [['plugin.json','plugin.schema.json'],['mcp.json','mcp.schema.json']]) {
  const validate=ajv.compile(JSON.parse(await readFile(new URL(`./schemas/${schema}`,import.meta.url),'utf8')));
  assert.ok(validate(JSON.parse(await readFile(new URL(`../${file}`,import.meta.url),'utf8'))),JSON.stringify(validate.errors));
  console.log(`${file}: valid against official Agent Plugins 1.0.0 schema`);
}
const icon=await readFile(new URL('../assets/icon.png',import.meta.url));
assert.equal(icon.readUInt32BE(16),180);assert.equal(icon.readUInt32BE(20),180);
assert.equal(icon.subarray(1,4).toString(),'PNG');
const skill=await readFile(new URL('../skills/news-and-threadlines/SKILL.md',import.meta.url),'utf8');
assert.match(skill,/^---\nname: news-and-threadlines\ndescription: .+\n---/);
const bundled=await stat(new URL('../bin/context-engine-news.mjs',import.meta.url));
assert.ok(bundled.size>0 && bundled.size<5_000_000);
// Launch from /tmp so relative imports cannot silently resolve the website's node_modules.
const client=new Client({name:'bundled-package-validation',version:'0.1.0'});
const config=JSON.parse(await readFile(new URL('../mcp.json',import.meta.url),'utf8')).mcpServers['context-engine-news'];
const transport=new StdioClientTransport({command:process.execPath,args:[new URL(`../${config.args[0]}`,import.meta.url).pathname],cwd:'/tmp',stderr:'inherit'});
try {
  await client.connect(transport);assert.equal((await client.listTools()).tools.length,5);
  console.log(`Bundled stdio runtime: initializes from outside the package (${Math.round(bundled.size/1024)} KiB)`);
} finally {await client.close();}
console.log('Icon: square PNG with background plate; skill: valid frontmatter.');
