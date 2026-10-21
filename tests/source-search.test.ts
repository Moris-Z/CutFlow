import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SourceSearch,basicSearchTerms,boundedFetch,parseStockPage,safeStockURL,type StockCandidate} from '../server/source-search';
import {Store} from '../server/store';
import {updateSettings} from '../server/settings';
import type {Asset} from '../shared/types';
updateSettings({model_api_key:'',model_name:''});
const candidate:StockCandidate={title:'Coffee',description:'Serving a cup',source_url:'https://mixkit.co/free-stock-video/serving-coffee-123/',download_url:'https://assets.mixkit.co/videos/123/123-1080.mp4',license_url:'https://mixkit.co/license/#videoFree'};
const asset:Asset={id:'fixture',name:'Coffee.mp4',file_path:'/private/fixture.mp4',url:'/media/fixture.mp4',thumbnail_url:'/media/thumbnail.jpg',duration_ms:10000,width:1920,height:1080,fps:30,has_audio:false,sha256:'fixture',created_at:'2026-10-06T00:00:00Z',warnings:[],shots:[{id:'shot',asset_id:'fixture',start_ms:0,end_ms:10000,summary:'尚未分析',evidence:{type:'metadata',description:'Metadata only',confidence:1}}]};
async function terminal(search:SourceSearch,id:string){for(let i=0;i<200;i++){await new Promise(r=>setTimeout(r,5));const job=await search.get(id);if(job.status!=='searching'){await new Promise(r=>setTimeout(r,10));return job;}}throw Error('search did not complete');}
test('search extracts product topics; stock parser imports only explicit free-license videos on supported hosts',()=>{
 assert.deepEqual(basicSearchTerms('温暖的咖啡广告'),['coffee']);assert.deepEqual(basicSearchTerms('咖啡的感觉','运动鞋'),['fitness','shoes']);assert.deepEqual(basicSearchTerms('按产品演示风格剪辑视频'),[]);
 const node={'@type':'VideoObject','@id':candidate.source_url+'#video',contentUrl:candidate.download_url,name:candidate.title,description:candidate.description,isAccessibleForFree:true,license:candidate.license_url};
 const items=[node,node,{...node,license:'https://mixkit.co/license/#videoRestricted'},{...node,isAccessibleForFree:false},{...node,contentUrl:'https://localhost/private.mp4'},{...node,contentUrl:'https://assets.mixkit.co.evil.test/a.mp4'}];
 const html=`<script type="application/ld+json">${JSON.stringify({'@graph':items})}</script><script type="application/ld+json">broken</script>`;
 assert.deepEqual(parseStockPage(html),[candidate]);assert(!safeStockURL('https://assets.mixkit.co/a.mp4?redirect=evil','media'));assert(!safeStockURL('http://assets.mixkit.co/a.mp4','media'));assert(!safeStockURL('https://user:pw@assets.mixkit.co/a.mp4','media'));
});
test('download follows safe category redirects, blocks other hosts before contact, and enforces stream limits',async()=>{
 const seen:string[]=[];
 const request=(async(url:unknown)=>{seen.push(String(url));return seen.length===1?new Response(null,{status:301,headers:{location:'/free-stock-video/coffee/'}}):new Response('ok');}) as typeof fetch;
 assert.equal((await boundedFetch('https://mixkit.co/free-stock-video/discover/coffee/',10,1000,request)).toString(),'ok');assert.equal(seen.length,2);
 let calls=0;await assert.rejects(()=>boundedFetch(candidate.download_url,100,1000,(async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}});}) as typeof fetch),/支持的来源/);assert.equal(calls,1);
 await assert.rejects(()=>boundedFetch(candidate.download_url,3,1000,(async()=>new Response('too big')) as typeof fetch),/过大/);
});
test('search persists provenance without inventing visual evidence, reuses assets, and skips deleted assets',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-search-')),store=new Store(root);let downloads=0;
 try{
  const search=new SourceSearch(store,path.join(root,'search'),{discover:async()=>[candidate,candidate],download:async()=>{downloads++;return Buffer.from('fixture');},ingest:async()=>structuredClone(asset)});
  const result=await terminal(search,(await search.start('咖啡')).id);assert.equal(result.status,'ready');assert.equal(result.assets.length,1);assert.equal(result.assets[0].file_path,'');assert.equal(result.assets[0].source?.url,candidate.source_url);assert.deepEqual(result.assets[0].shots,asset.shots);assert.equal(downloads,1);
  const saved=store.asset(asset.id)!;saved.shots[0].summary='人工确认的完整动作';store.saveAsset(saved);
  const again=await terminal(search,(await search.start('咖啡')).id);assert.equal(again.assets[0].shots[0].summary,saved.shots[0].summary);assert.equal(downloads,1);
  const reopened=new SourceSearch(store,path.join(root,'search'));assert.equal((await reopened.get(result.id)).status,'ready');
  store.setDeleted('assets',asset.id,true);const removed=await terminal(search,(await search.start('咖啡')).id);assert.equal(removed.status,'failed');assert.equal(removed.assets.length,0);assert.equal(downloads,1);assert(store.asset(asset.id)?.deleted_at);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});
test('only one search runs at once, failures release the slot, and interrupted jobs do not auto-restart',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-search-')),store=new Store(root);let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 try{
  const search=new SourceSearch(store,path.join(root,'search'),{discover:async()=>{await gate;return [];}});
  const first=await search.start('咖啡');await assert.rejects(()=>search.start('咖啡'),{code:'SEARCH_BUSY'});release();assert.equal((await terminal(search,first.id)).status,'failed');
  const retry=await search.start('请剪辑一段视频');assert.equal((await terminal(search,retry.id)).status,'failed');
  await writeFile(path.join(root,'search','interrupted.json'),JSON.stringify({...first,id:'interrupted',status:'searching'}));
  const recovered=new SourceSearch(store,path.join(root,'search'),{discover:async()=>{throw Error('must not restart');}});assert.match((await recovered.get('interrupted')).message,/中断/);assert.equal(JSON.parse(await readFile(path.join(root,'search','interrupted.json'),'utf8')).status,'failed');
 }finally{release();store.close();await rm(root,{recursive:true,force:true});}
});
