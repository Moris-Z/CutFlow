import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {EnterpriseSources,documentVideos,documentReferences,larkResource,larkResults,type CliRunner} from '../server/enterprise-sources';
import {SourceSearch,type StockCandidate} from '../server/source-search';
import {command} from '../server/media';
import {Store} from '../server/store';
import {updateSettings} from '../server/settings';
import {createApp} from '../server/server';
import type {AddressInfo} from 'node:net';
updateSettings({model_api_key:'',model_name:''});
const auth={identities:{user:{available:true,verified:true}}};
const file='https://bytedance.larkoffice.com/file/videoToken123';
const doc='https://bytedance.larkoffice.com/docx/documentToken123';
const candidate:StockCandidate={provider:'Feishu',usage:'enterprise_reference',title:'游戏实录.mp4',description:'未分析画面',source_url:file,download_url:'',license_url:'',lark:{type:'file',token:'videoToken123'}};

test('enterprise references accept only supported document/file URLs and video attachments, without using arbitrary URLs',()=>{
 assert.equal(larkResource(file)?.token,'videoToken123');
 for(const url of ['https://larkoffice.com.evil.test/file/videoToken123','https://user:pass@bytedance.larkoffice.com/file/videoToken123','http://127.0.0.1/a','https://bytedance.larkoffice.com:4433/file/videoToken123'])assert.equal(larkResource(url),undefined);
 const parsed=documentVideos('<source token="mediaToken123" name="游戏.mp4" url="http://127.0.0.1/private"/><source token="otherToken123" name="passwords.txt"/><source token="../../secret" name="a.mp4"/>',doc,'产品介绍');
 assert.equal(parsed.length,1);assert.equal(parsed[0].download_url,'');assert.equal(parsed[0].lark?.type,'media');assert(parsed[0].source_url.startsWith(doc+'#media-'));
 assert.equal(larkResults({results:[{result_meta:{url:file,title_highlighted:'<h>游戏</h>.mp4'}}]})[0].title,'游戏.mp4');
 assert.throws(()=>larkResults({unexpected:[]}),/格式发生变化/);
});
test('document video references remain separate from media and accept only matching safe video pages',()=>{
 const link='<a href="https://www.douyin.com/video/7533192738196557095?tracking=1">植物大战僵尸融合版</a>';
 const refs=documentReferences(link+link+'<a href="https://evil.test/video/7533192738196557095">植物大战僵尸</a><a href="https://www.douyin.com/video/7533192738196557096">其他游戏</a>',doc,'植物大战僵尸');
 assert.equal(refs.length,1);assert.equal(refs[0].url,'https://www.douyin.com/video/7533192738196557095');assert.equal(refs[0].document_url,doc);assert.deepEqual(documentVideos(link,doc,'文档'),[]);
});
test('reference-only search preserves useful links and does not claim no video exists or import a page',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-reference-')),store=new Store(root);
 try{const references=[{provider:'Feishu' as const,title:'植物大战僵尸',url:'https://www.douyin.com/video/7533192738196557095',document_url:doc}];
 const search=new SourceSearch(store,path.join(root,'search'),{discoverEnterprise:async()=>({candidates:[],references,report:{provider:'Feishu',status:'ok',found:0,references_found:1}}),discoverGame:async()=>[],downloadEnterprise:async()=>{assert.fail('Page must not be downloaded');}});
 const job=await search.wait((await search.start('植物大战僵尸广告')).id);assert.equal(job.status,'failed');assert.deepEqual(job.references,references);assert.match(job.message,/找到 1 个相关视频链接/);assert.equal(store.assets().length,0);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});
test('a bounded material refinement finds video examples behind general documents without reading documents twice',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-refinement-'));const reads:string[]=[],queries:string[]=[];
 try{const general=Array.from({length:20},(_,i)=>({title:`讨论文档 ${i}`,url:`https://bytedance.larkoffice.com/docx/generalToken${i}`}));
 const cli:CliRunner=async args=>{if(args[0]==='auth')return auth;
  if(args[1]==='+search'){const q=args[args.indexOf('--query')+1];queries.push(q);return {ok:true,identity:'user',data:{results:args.includes('file')?[]:q.endsWith(' 素材')?[general[0],{title:'游戏视频范例',url:doc}]:general}};}
  const url=args[args.indexOf('--doc')+1];assert(!reads.includes(url),'Do not re-read a document');reads.push(url);
  return {ok:true,identity:'user',data:{document:{content:url===doc?'<a href="https://www.douyin.com/video/7533192738196557095">植物大战僵尸融合版</a>':'<p>讨论文档</p>'}}};
 };
 const result=await new EnterpriseSources(root,cli).discover('植物大战僵尸');assert.equal(queries.length,3);assert.equal(queries[2],'植物大战僵尸 素材');assert.equal(reads.length,9);assert.equal(result.references?.length,1);assert.equal(result.candidates.length,0);assert.equal(result.report.references_found,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('expired user is never replaced by a ready bot, and connector preferences survive restart',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-enterprise-'));const commands:string[][]=[];
 try{const cli:CliRunner=async args=>{commands.push(args);return {identities:{bot:{available:true,verified:true},user:{available:false,tokenStatus:'expired'}}};};
  const source=new EnterpriseSources(root,cli);const result=await source.discover('植物大战僵尸');assert.equal(result.report.status,'needs_auth');assert.equal(result.candidates.length,0);assert(commands.every(c=>c[0]==='auth'));
  await source.setEnabled(false);const reopened=new EnterpriseSources(root,cli);assert.equal((await reopened.larkStatus()).status,'disabled');assert.equal((await reopened.status())[1].status,'pending_connection');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('search uses user-scoped bounded queries and discovers embedded media without storing full document text',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-enterprise-'));const calls:string[][]=[];
 try{const cli:CliRunner=async args=>{calls.push(args);if(args[0]==='auth')return auth;
  assert(args.includes('user'));
  if(args[1]==='+search')return {ok:true,identity:'user',data:{has_more:true,results:[{result_meta:{title:'游戏实录.mp4',url:file}},{result_meta:{title:'视频素材',url:doc}},{title:'非视频.pdf',url:file.replace('videoToken123','anotherToken123')}]}};
  return {ok:true,identity:'user',data:{document:{content:'<p>internal unrelated memo must not persist</p><source token="mediaToken123" name="玩法.mp4"/>'}}};};
  const result=await new EnterpriseSources(root,cli).discover('植'.repeat(60));assert.equal(result.candidates.length,2);assert.equal(result.report.found,2);assert.match(result.report.message||'',/首批/);assert.doesNotMatch(JSON.stringify(result),/unrelated memo/);
  const search=calls.find(c=>c[1]==='+search')!;assert.equal([...search[search.indexOf('--query')+1]].length,30);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('download validates source and rechecks the user connection, with an isolated relative destination',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-enterprise-'));let valid=true,downloads=0;
 try{const cli:CliRunner=async(args,options)=>{if(args[0]==='auth')return valid?auth:{identities:{user:{available:false}}};downloads++;assert.equal(args[args.indexOf('--output')+1],'source.mp4');assert.equal(args[args.indexOf('--as')+1],'user');await writeFile(options!.output!,'fake media bytes');return {ok:true,identity:'user'};};
  const source=new EnterpriseSources(root,cli),destination=path.join(root,'source.mp4');
  await source.download(candidate,destination);assert.equal(downloads,1);valid=false;await assert.rejects(()=>source.download(candidate,destination),/连接不可用/);assert.equal(downloads,1);
  await assert.rejects(()=>source.download({...candidate,source_url:'https://127.0.0.1/file/videoToken123'},destination),/来源无效/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('enterprise video is really ingested when public search fails; private text is not treated as shot evidence',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-enterprise-')),store=new Store(root);
 try{const clip=path.join(root,'fixture.mp4');await command('ffmpeg',['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=green:s=160x90:r=30:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',clip]);
  const search=new SourceSearch(store,path.join(root,'search'),{discoverEnterprise:async()=>({candidates:[candidate],report:{provider:'Feishu',status:'ok',found:1}}),downloadEnterprise:async(_c,d)=>{await copyFile(clip,d);},discoverGame:async()=>{throw Error('public service unavailable');}});
  const result=await search.wait((await search.start('制作植物大战僵尸游戏广告')).id);assert.equal(result.status,'ready');assert.equal(result.assets.length,1);assert.equal(result.assets[0].name,'游戏实录.mp4');assert.equal(result.assets[0].source?.usage,'enterprise_reference');assert.equal(result.assets[0].has_audio,true);assert.equal(result.assets[0].shots[0].evidence.type,'metadata');assert.equal(result.sources?.find(s=>s.provider==='Steam')?.status,'error');assert.match(result.message,/Feishu/);
  const again=await search.wait((await search.start('制作植物大战僵尸游戏广告')).id);assert.deepEqual(again.assets.map(a=>a.id),result.assets.map(a=>a.id));
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});
test('connection endpoint exposes no account identity or secrets and does not claim Douyin is connected',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-enterprise-'));
 const {app,store}=createApp(root,{larkCli:async()=>({...auth,appSecret:'must-not-leak',identities:{user:{available:false,openId:'private-user-id'}}})});const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/source-connections`;const data=await (await fetch(base)).json();assert.equal(data[0].status,'needs_auth');assert.equal(data[1].status,'pending_connection');assert.doesNotMatch(JSON.stringify(data),/must-not-leak|private-user-id/);
  const res=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({feishu_enabled:false})});assert.equal(res.status,200);assert.equal((await res.json())[0].status,'disabled');
 }finally{await new Promise<void>(r=>server.close(()=>r()));store.close();await rm(root,{recursive:true,force:true});}
});
