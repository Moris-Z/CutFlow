import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DouyinSource,douyinReferences} from '../server/douyin-source';
import {SourceSearch} from '../server/source-search';
import {Store} from '../server/store';
import {createApp} from '../server/server';
import type {AddressInfo} from 'node:net';

test('Douyin output is only bounded untrusted page references, not media files',()=>{
 const video={title:'植物大战僵尸',url:'https://www.douyin.com/video/7533192738196557095?tracking=1'};
 const data={result:JSON.stringify({output:JSON.stringify({videos:[video,video,{...video,url:'https://www.iesdouyin.com/share/video/7533192738196557095/?scene_from=dy_open_search_video'},{...video,url:'http://127.0.0.1/private'},{...video,url:'https://evil.test/video/7533192738196557095'}]})})};
 const refs=douyinReferences(data);assert.equal(refs.length,1);assert.equal(refs[0].url,'https://www.douyin.com/video/7533192738196557095');assert.equal(refs[0].provider,'Douyin');assert(!('download_url' in refs[0]));assert.deepEqual(douyinReferences({result:'malformed'}),[]);
});
test('official gateway uses only fixed endpoints and stores a server-only credential with restricted permissions',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-douyin-'));const calls:{url:string;body:any}[]=[];
 const transport:typeof fetch=async(url,options)=>{assert.equal(new Headers(options?.headers).get('api-key'),'fixture-api-key-123');assert.equal(options?.redirect,'error');const body=JSON.parse(options!.body as string);calls.push({url:String(url),body});assert.equal(body.agent_id,'assist_7689858916037151526');assert.equal(body.tenant_id,'douyin_experience');
 return new Response(JSON.stringify(String(url).endsWith('create_conversation_outer')?{conversation_id:'fixture-conversation'}:{result:JSON.stringify({output:JSON.stringify({videos:[{title:'游戏实录',url:'https://www.douyin.com/video/7533192738196557095'}]})})}));};
 try{const source=new DouyinSource(root,transport);assert.equal((await source.status()).status,'pending_connection');assert.equal((await source.configure('fixture-api-key-123')).status,'ready');assert.equal((await stat(path.join(root,'douyin-credentials.json'))).mode&0o777,0o600);
 const result=await source.discover('植物大战僵尸');assert.equal(result.references.length,1);assert.equal(result.report.found,0);assert.equal(result.report.references_found,1);assert.equal(calls.length,2);assert.match(calls[1].body.query,/植物大战僵尸/);assert.equal(calls[1].url,'https://douyin-ai.bytedance.net/api/ai_platform/gateway_ingress/chat_outer');assert.doesNotMatch(JSON.stringify(await source.status()),/fixture-api-key/);
 assert.equal((await new DouyinSource(root,transport).status()).status,'ready');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('gateway authentication errors stay sanitized and do not become empty successful searches',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-douyin-'));
 try{const source=new DouyinSource(root,async()=>new Response(JSON.stringify({code:401,message:'secret internal diagnostics'})));assert.equal((await source.configure('fixture-api-key-123')).status,'error');const result=await source.discover('游戏');assert.equal(result.report.status,'error');assert.doesNotMatch(JSON.stringify(result),/secret|fixture-api-key/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Douyin references survive public search failure without downloading a web page',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-douyin-search-')),store=new Store(root);
 try{const refs=[{provider:'Douyin' as const,title:'植物大战僵尸',url:'https://www.douyin.com/video/7533192738196557095'}];const search=new SourceSearch(store,path.join(root,'search'),{discoverDouyin:async()=>({references:refs,report:{provider:'Douyin',status:'ok',found:0,references_found:1}}),discoverGame:async()=>{throw Error('unavailable');}});const result=await search.wait((await search.start('植物大战僵尸广告')).id);assert.deepEqual(result.references,refs);assert.equal(result.assets.length,0);assert.match(result.message,/找到 1 个相关视频链接/);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});
test('local API accepts credentials only locally and never returns them',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-douyin-api-'));const {app,store}=createApp(root,{larkCli:async()=>({identities:{user:{available:false}}}),douyinFetch:async()=>new Response(JSON.stringify({conversation_id:'fixture'}))});const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/source-connections`;
 try{const body=JSON.stringify({api_key:'fixture-api-key-123'});const blocked=await fetch(base+'/douyin',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.test'},body});assert.equal(blocked.status,403);
 const result=await fetch(base+'/douyin',{method:'POST',headers:{'Content-Type':'application/json'},body});assert.equal(result.status,200);assert.equal((await result.json()).status,'ready');const statuses=await (await fetch(base)).json();assert.equal(statuses[1].status,'ready');assert.doesNotMatch(JSON.stringify(statuses),/fixture-api-key/);
 }finally{await new Promise<void>(r=>server.close(()=>r()));store.close();await rm(root,{recursive:true,force:true});}
});
