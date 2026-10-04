import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const projectRoot=dirname(dirname(fileURLToPath(import.meta.url)));
const root=resolve(projectRoot,'dist');
const appVersion=JSON.parse(await readFile(resolve(projectRoot,'version.json'),'utf8')).version;
const all=await readdir(root,{recursive:true});
const files=all.map(path=>path.replaceAll('\\','/')).filter(path=>
  path==='index.html'||path==='manifest.webmanifest'||path==='favicon.svg'||
  /^(assets|fonts|icons|archives|licenses)\/[^/]+\.[^/]+$/.test(path)||
  /^audio\/(atmosphere|motif|pulse)\.ogg$/.test(path)
).sort();
if(!files.some(path=>/^assets\/index-.*\.js$/.test(path)))throw Error('Build the application before generating the offline cache.');
const worker=await readFile(resolve(projectRoot,'scripts/pwa-worker.js'),'utf8');
const hash=createHash('sha256').update(worker);let bytes=0;
for(const file of files){const content=await readFile(resolve(root,file));hash.update(file).update(content);bytes+=content.length}
const contentHash=hash.digest('hex').slice(0,16);
const cacheVersion=`${appVersion}-${contentHash}`;
await writeFile(resolve(root,'sw.js'),worker.replace('__CACHE_VERSION__',JSON.stringify(cacheVersion)).replace('__PRECACHE_FILES__',JSON.stringify(files)));
await writeFile(resolve(root,'pwa-build.json'),JSON.stringify({appVersion,version:cacheVersion,contentHash,bytes,files},null,2));
console.log(`Offline release ${cacheVersion}: ${files.length} files, ${(bytes/1024/1024).toFixed(1)} MiB.`);
