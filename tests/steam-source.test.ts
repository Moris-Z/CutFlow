import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {discoverSteam,sameGame,safeSteamURL,steamFetch,steamTracks,steamSegments} from '../server/steam-source';
import {SourceSearch,type StockCandidate} from '../server/source-search';
import {searchIntent} from '../server/search-intent';
import {Store} from '../server/store';
import {updateSettings} from '../server/settings';
import type {Asset} from '../shared/types';
updateSettings({model_api_key:'',model_name:''});
const rootURL='https://video.akamai.steamstatic.com/store_trailers/3590/1872/abcdef/1750483994/';
const master=rootURL+'hls_264_master.m3u8?t=123';
const source:StockCandidate={provider:'Steam',usage:'publisher_reference',title:'Plants vs. Zombies GOTY Edition · Trailer',description:'Plants vs. Zombies official trailer',source_url:'https://store.steampowered.com/app/3590/#trailer-900829',download_url:master,license_url:''};
const masterText='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080,AUDIO="audio"\nhigh.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,AUDIO="audio"\nmedium.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x480,AUDIO="audio"\nlow.m3u8\n';
const mediaText='#EXTM3U\n#EXT-X-MAP:URI="dash_h264/init-stream0.m4s"\n#EXTINF:3\ndash_h264/chunk-stream0-00001.m4s\n#EXTINF:2\ndash_h264/chunk-stream0-00002.m4s\n#EXT-X-ENDLIST';

test('game matching keeps editions but never silently substitutes sequels or remasters',()=>{
 assert(sameGame('Plants vs. Zombies GOTY Edition',['plants-vs-zombies']));
 assert(!sameGame('Plants vs. Zombies™: Replanted',['plants-vs-zombies']));
 assert(!sameGame('Plants vs. Zombies Garden Warfare 2: Deluxe Edition',['plants-vs-zombies']));
 assert(!sameGame('Plants vs. Zombies GOTY Edition',['plants-vs-zombies-2']));
 assert(sameGame('Plants vs. Zombies™ Garden Warfare 2: Deluxe Edition',['plants-vs-zombies-garden-warfare-2']));
 assert.deepEqual(searchIntent('制作植物大战僵尸2的游戏广告').aliases,['plants-vs-zombies-2']);
 assert.deepEqual(searchIntent('制作植物大战僵尸重植版的广告').aliases,['plants-vs-zombies-replanted']);
 assert.equal(searchIntent('生成一个黑神话悟空的游戏广告').subject,'黑神话悟空');
});
test('Steam discovery reads matching store entries and validates movie URLs and app identity',async()=>{
 const visited:string[]=[];
 const request=(async(input:unknown)=>{const url=String(input);visited.push(url);
  if(url.includes('storesearch'))return Response.json({items:[{id:3654560,type:'app',name:'Plants vs. Zombies: Replanted'},{id:3590,type:'app',name:'Plants vs. Zombies GOTY Edition'}]});
  return Response.json({'3590':{success:true,data:{name:'Plants vs. Zombies GOTY Edition',movies:[{id:900829,name:'Trailer',hls_h264:master},{id:2,name:'wrong game',hls_h264:master.replace('/3590/','/3654560/')},{id:3,name:'unsafe',hls_h264:'https://127.0.0.1/private.m3u8'}]}}});
 }) as typeof fetch;
 const found=await discoverSteam(['plants-vs-zombies'],request);assert.equal(found.length,1);assert.equal(found[0].provider,'Steam');assert.equal(found[0].usage,'publisher_reference');assert.equal(found[0].license_url,'');assert.equal(found[0].source_url,source.source_url);assert.equal(visited.length,2);assert(visited[1].includes('appids=3590'));
});
test('Steam fetch validates redirects before sending and enforces byte limits',async()=>{
 assert(safeSteamURL(master,'media'));assert(!safeSteamURL(master.replace('steamstatic.com','steamstatic.com.evil.test'),'media'));assert(!safeSteamURL('http://127.0.0.1/a.mp4','media'));
 let count=0;
 await assert.rejects(()=>steamFetch(master,'media',100,(async()=>{count++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/a.mp4'}});}) as typeof fetch),/支持的来源/);assert.equal(count,1);
 await assert.rejects(()=>steamFetch(master,'media',2,(async()=>new Response('abc')) as typeof fetch),/大小限制/);
});
test('HLS selection preserves separate audio; only bounded complete same-trailer media lists are accepted',()=>{
 assert.deepEqual(steamTracks(masterText,master),{video:rootURL+'medium.m3u8',audio:rootURL+'audio.m3u8'});
 const parts=steamSegments(mediaText,rootURL+'medium.m3u8');assert.equal(parts.length,3);assert.equal(parts[0],rootURL+'dash_h264/init-stream0.m4s');
 for(const bad of [mediaText.replace('#EXT-X-ENDLIST',''),mediaText.replace('#EXTINF:3','#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:3'),mediaText.replace('chunk-stream0-00001.m4s','../../private.mp4'),mediaText.replace('dash_h264/chunk-stream0-00001.m4s','https://127.0.0.1/private.mp4'),mediaText.replace('#EXTINF:3','#EXTINF:601')])assert.throws(()=>steamSegments(bad,rootURL+'medium.m3u8'));
 assert.throws(()=>steamTracks(masterText.replace('medium.m3u8','https://127.0.0.1/private.m3u8'),master));
});
test('game search uses Steam importer, records truthful provenance, reuses downloads and distinguishes import failure',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cutflow-steam-')),store=new Store(root);let downloads=0;
 const asset:Asset={id:'game-fixture',name:'game.mp4',file_path:'/test.mp4',url:'/media/test.mp4',thumbnail_url:'/media/test.jpg',width:800,height:600,fps:30,duration_ms:44000,has_audio:true,sha256:'fixture',created_at:new Date().toISOString(),warnings:[],shots:[]};
 try{
  const search=new SourceSearch(store,path.join(root,'search'),{discover:async()=>{throw Error('Must not use generic stock for this game');},discoverGame:async()=>[source],downloadGame:async(_url,file)=>{downloads++;await writeFile(file,'fixture');},ingest:async()=>structuredClone(asset)});
  const first=await search.wait((await search.start('帮我制作植物大战僵尸游戏广告')).id);assert.equal(first.status,'ready');assert.equal(first.sources?.[0].provider,'Steam');assert.equal(first.assets[0].source?.usage,'publisher_reference');assert.equal(first.assets[0].source?.license_url,'');assert.equal(first.assets[0].file_path,'');
  await search.wait((await search.start('植物大战僵尸')).id);assert.equal(downloads,1);
  const failedSource={...source,source_url:source.source_url.replace('900829','123')};
  const failure=new SourceSearch(store,path.join(root,'failed-search'),{discoverGame:async()=>[failedSource],downloadGame:async()=>{throw Error('network fixture failure');}});
  const failed=await failure.wait((await failure.start('植物大战僵尸')).id);assert.equal(failed.status,'failed');assert.match(failed.message,/找到 1 段相关视频，但导入没有完成/);assert.match(failed.warnings[0],/network fixture failure/);assert.equal(failed.sources?.[0].found,1);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});
