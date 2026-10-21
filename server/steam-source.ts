import path from 'node:path';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {command} from './media.js';
import type {StockCandidate} from './source-search.js';

const videoHosts=new Set(['video.akamai.steamstatic.com','video.fastly.steamstatic.com','video.cloudflare.steamstatic.com']);
export function safeSteamURL(value:string,kind:'api'|'media'|'page'){
 try{
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port)return false;
  if(kind==='media')return videoHosts.has(u.hostname)&&/^\/store_trailers\/\d+\/\d+\/[a-f0-9]+\/\d+\/[a-zA-Z0-9_./-]+\.(m3u8|m4s|mp4|ts)$/.test(u.pathname)&&!u.hash&&[...u.searchParams.keys()].every(k=>k==='t');
  if(u.hostname!=='store.steampowered.com')return false;
  if(kind==='page')return /^\/app\/\d+\/$/.test(u.pathname)&&!u.search&&/^#trailer-\d+$/.test(u.hash);
  return ['/api/storesearch/','/api/appdetails'].includes(u.pathname)&&!u.hash&&[...u.searchParams.keys()].every(k=>['term','l','cc','appids'].includes(k));
 }catch{return false;}
}
export async function steamFetch(url:string,kind:'api'|'media',max=3_000_000,request:typeof fetch=fetch,signal=AbortSignal.timeout(25000)){
 for(let hop=0;hop<4;hop++){
  if(!safeSteamURL(url,kind))throw Error('游戏视频链接不在支持的来源内');
  const response=await request(url,{redirect:'manual',signal,headers:{'User-Agent':'CutFlow/0.1 (public game trailer discovery)'}});
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get('location');await response.body?.cancel();
   if(!location||hop===3)throw Error('游戏视频来源重定向异常');url=new URL(location,url).href;continue;
  }
  if(!response.ok||!response.body)throw Error(`Steam 视频来源暂时无法访问（${response.status}）`);
  if(Number(response.headers.get('content-length'))>max){await response.body.cancel();throw Error('游戏视频超出下载大小限制');}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max)throw Error('游戏视频超出下载大小限制');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks);
 }
 throw Error('游戏视频来源重定向异常');
}
const normalized=(s:string)=>s.toLowerCase().replace(/™|®/g,'').replace(/\b(goty|game of the year|deluxe|definitive|complete|edition)\b/g,'').replace(/[^\p{L}\p{N}]/gu,'');
/** Match the named game itself; never substitute a different sequel or spin-off. */
export const sameGame=(title:string,queries:string[])=>queries.some(q=>normalized(title)===normalized(q.replace(/-/g,' ')));
export async function discoverSteam(queries:string[],request:typeof fetch=fetch):Promise<StockCandidate[]>{
 const games=new Map<number,{id:number;name:string}>();
 for(const term of [...new Set(queries)].slice(0,2)){
  const url=new URL('https://store.steampowered.com/api/storesearch/');url.search=new URLSearchParams({term:term.replace(/-/g,' '),l:'schinese',cc:'us'}).toString();
  const data=JSON.parse((await steamFetch(url.href,'api',3_000_000,request)).toString());
  for(const item of Array.isArray(data.items)?data.items:[])if(item.type==='app'&&Number.isSafeInteger(item.id)&&item.id>0&&typeof item.name==='string'&&sameGame(item.name,queries))games.set(item.id,{id:item.id,name:item.name});
 }
 const found:StockCandidate[]=[];
 for(const game of [...games.values()].slice(0,2)){
  const url=`https://store.steampowered.com/api/appdetails?appids=${game.id}&l=schinese&cc=us`;
  const entry=JSON.parse((await steamFetch(url,'api',3_000_000,request)).toString())[String(game.id)];
  if(!entry?.success||!sameGame(String(entry.data?.name||''),queries))continue;
  for(const movie of Array.isArray(entry.data.movies)?entry.data.movies:[]){
   if(!Number.isSafeInteger(movie.id)||movie.id<=0||typeof movie.name!=='string'||!safeSteamURL(movie.hls_h264,'media'))continue;
   if(new URL(movie.hls_h264).pathname.split('/')[2]!==String(game.id))continue;
   found.push({provider:'Steam',title:`${entry.data.name} · ${movie.name}`,description:`${entry.data.name} 商店页发布的视频：${movie.name}`,source_url:`https://store.steampowered.com/app/${game.id}/#trailer-${movie.id}`,download_url:movie.hls_h264,license_url:'',usage:'publisher_reference'});
  }
 }
 return [...new Map(found.map(c=>[c.source_url,c])).values()].slice(0,3);
}
function childURL(base:string,relative:string){
 const url=new URL(relative,base).href;
 const root=new URL(base).pathname.split('/').slice(0,6).join('/')+'/';
 if(!safeSteamURL(url,'media')||new URL(url).hostname!==new URL(base).hostname||!new URL(url).pathname.startsWith(root))throw Error('视频清单包含不支持的分段链接');
 return url;
}
export function steamTracks(text:string,base:string){
 if(!text.startsWith('#EXTM3U'))throw Error('游戏视频清单格式错误');
 const lines=text.split(/\r?\n/).map(s=>s.trim()),variants:{url:string;height:number;audio?:string}[]=[];
 const audio=new Map<string,string>();
 for(const line of lines){if(!line.startsWith('#EXT-X-MEDIA:')||!line.includes('TYPE=AUDIO'))continue;
  const group=line.match(/GROUP-ID="([^"]+)"/)?.[1],uri=line.match(/URI="([^"]+)"/)?.[1];if(group&&uri&&!audio.has(group))audio.set(group,childURL(base,uri));
 }
 for(let i=0;i<lines.length;i++)if(lines[i].startsWith('#EXT-X-STREAM-INF:')){
  const uri=lines[i+1],height=Number(lines[i].match(/RESOLUTION=\d+x(\d+)/)?.[1]||0),group=lines[i].match(/AUDIO="([^"]+)"/)?.[1];
  if(uri&&!uri.startsWith('#'))variants.push({url:childURL(base,uri),height,audio:group?audio.get(group):undefined});
 }
 if(!variants.length)return {video:base};
 const sorted=variants.sort((a,b)=>b.height-a.height),chosen=sorted.find(v=>v.height<=720)||sorted.at(-1)!;
 return {video:chosen.url,audio:chosen.audio};
}
export function steamSegments(text:string,base:string){
 if(!text.startsWith('#EXTM3U')||!text.includes('#EXT-X-ENDLIST'))throw Error('仅支持已发布的完整视频');
 if(/#EXT-X-(KEY|SESSION-KEY|BYTERANGE|DISCONTINUITY)/.test(text))throw Error('这段游戏视频的流格式暂不支持导入');
 const lines=text.split(/\r?\n/).map(s=>s.trim()),maps=lines.filter(s=>s.startsWith('#EXT-X-MAP:'));
 if(maps.length!==1)throw Error('这段视频缺少完整的媒体初始化信息');
 const init=maps[0].match(/URI="([^"]+)"/)?.[1];if(!init)throw Error('这段视频缺少媒体初始化信息');
 const duration=[...text.matchAll(/#EXTINF:([\d.]+)/g)].reduce((n,m)=>n+Number(m[1]),0);
 const parts=lines.filter(s=>s&&!s.startsWith('#'));
 if(duration<=0||duration>600||!parts.length||parts.length>300)throw Error('这段游戏视频过长，暂不自动导入');
 return [childURL(base,init),...parts.map(s=>childURL(base,s))];
}
/** Download validated fragments, then remux local files only. FFmpeg never reads remote URLs. */
export async function downloadSteam(url:string,destination:string,request:typeof fetch=fetch){
 const signal=AbortSignal.timeout(180000),temp=path.join(path.dirname(destination),`steam-${randomUUID()}`);await mkdir(temp,{recursive:true});
 let total=0;
 try{
  const master=(await steamFetch(url,'media',1_000_000,request,signal)).toString(),tracks=steamTracks(master,url);
  const paths:string[]=[];
  for(const track of [tracks.video,tracks.audio].filter((v):v is string=>!!v)){
   const manifest=track===url?master:(await steamFetch(track,'media',1_000_000,request,signal)).toString(),segments=steamSegments(manifest,track);
   const chunks:Buffer[]=new Array(segments.length);let next=0;
   const workers=await Promise.allSettled(Array.from({length:4},async()=>{while(next<segments.length){const index=next++;const data=await steamFetch(segments[index],'media',12*1024*1024,request,signal);total+=data.length;if(total>160*1024*1024)throw Error('游戏视频超出下载大小限制');chunks[index]=data;}}));
   const failed=workers.find((r):r is PromiseRejectedResult=>r.status==='rejected');if(failed)throw failed.reason;
   const file=path.join(temp,`track-${paths.length}.mp4`);await writeFile(file,Buffer.concat(chunks));paths.push(file);
  }
  const inputs=paths.flatMap(p=>['-protocol_whitelist','file,pipe','-format_whitelist','mov,mp4,m4a','-i',p]);
  await command('ffmpeg',['-hide_banner','-nostdin','-y',...inputs,'-map','0:v:0','-map',tracks.audio?'1:a:0':'0:a:0?','-c','copy','-movflags','+faststart',destination],{timeout:60000,signal});
 }finally{await rm(temp,{recursive:true,force:true});}
}
