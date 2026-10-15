import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('bin',{recursive:true});
const result=await build({
  entryPoints:['src/stdio.mjs'], outfile:'bin/context-engine-news.mjs', bundle:true,
  platform:'node', format:'esm', target:'node22', minify:false, legalComments:'inline', metafile:true,
  banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"},
});
const packages=new Set(Object.keys(result.metafile.inputs).map(path=>path.match(/^(node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1]).filter(Boolean));
let notices='Third-party software included in the bundled MCP runtime.\n';
for(const directory of [...packages].sort()) {
  const metadata=JSON.parse(await readFile(`${directory}/package.json`,'utf8'));
  let license;
  for(const file of ['LICENSE','LICENSE.md','LICENSE.txt','license','license.md','COPYING']) {
    try {license=await readFile(`${directory}/${file}`,'utf8');break;} catch {}
  }
  if(!license) throw new Error(`Missing bundled dependency license: ${metadata.name}`);
  notices+=`\n\n${metadata.name} ${metadata.version}\n${license}`;
}
await writeFile('bin/THIRD_PARTY_NOTICES.txt',notices);
