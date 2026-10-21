import path from 'node:path';
import {readFileSync,existsSync,mkdirSync,copyFileSync} from 'node:fs';
import {copyFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {BgmPreferenceSchema,type Bgm,type MusicTrack,type MusicReference,type EDL,type Asset,type Patch} from '../shared/types.js';
import {Store} from './store.js';
import {assert} from './errors.js';
import {hashFile,probeMusic} from './media.js';
import {validateEDL} from './planner.js';
import {revisionRegions} from './revisions.js';
import {changeContract,describeChanges} from './revision-changes.js';

const bundled=fileURLToPath(new URL('../assets/music/',import.meta.url));
export function installMusic(store:Store){
 if(!existsSync(path.join(bundled,'catalog.json')))return;
 const tracks=JSON.parse(readFileSync(path.join(bundled,'catalog.json'),'utf8')) as MusicTrack[];
 for(const track of tracks){
  const directory=path.join(store.root,'media','music',track.id),file=path.join(directory,'source.mp3');
  mkdirSync(directory,{recursive:true});if(!existsSync(file))copyFileSync(path.join(bundled,track.id+'.mp3'),file);
  store.saveMusic({...track,file_path:file,url:`/media/music/${track.id}/source.mp3`});
 }
}
export function musicReferences():MusicReference[]{const file=path.join(bundled,'references.json');return existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];}
export function resolveBgm(store:Store,input?:unknown,allowDeleted=false):Bgm{
 const preference=BgmPreferenceSchema.parse(input??{});
 const track=store.musicTrack(preference.mode==='default'?store.defaultBgmId():preference.track_id||'');
 assert(track&&(allowDeleted||!track.deleted_at),'BGM_NOT_FOUND','请选择可用配乐，或先导入已授权的音频',422);
 assert(preference.start_ms<track.duration_ms,'BGM_START_INVALID','配乐起播位置必须小于音乐时长',422);
 const {id,sha256,title,author,license,license_url,source_url,attribution}=track;
 return {track_id:id,sha256,title,author,license,license_url,source_url,attribution,gain:preference.gain,start_ms:preference.start_ms,ducking:preference.ducking};
}
export function musicPath(store:Store,edl:EDL){
 if(!edl.bgm)return undefined;
 const track=store.musicTrack(edl.bgm.track_id);
 assert(track&&track.sha256===edl.bgm.sha256,'BGM_CHANGED','配乐缺失或已变化，请重新选择并确认',409);
 return track.file_path;
}
export async function importMusic(store:Store,file:string,name:string,details:{title:string;author:string;source_url:string;license_note?:string}){
 const metadata=await probeMusic(file),sha256=await hashFile(file),id='upload-'+sha256.slice(0,24);
 const previous=store.musicTrack(id);if(previous){if(previous.deleted_at)store.setDeleted('music',id,false);return store.musicTrack(id)!;}
 const ext=path.extname(name).toLowerCase(),directory=path.join(store.root,'media','music',id),destination=path.join(directory,'source'+ext);
 await mkdir(directory,{recursive:true});await copyFile(file,destination);
 assert(await hashFile(destination)===sha256,'MUSIC_COPY_FAILED','配乐复制校验失败');
 return store.saveMusic({id,...metadata,sha256,title:details.title||path.basename(name,ext),author:details.author||'用户提供',tags:['已导入'],file_path:destination,url:`/media/music/${id}/source${ext}`,license:details.license_note?'用户提供说明':'用户导入',license_url:'',source_url:details.source_url,attribution:[`${details.title||name} — ${details.author||'用户提供'}`,details.license_note,details.source_url].filter(Boolean).join('\n'),origin:'upload'});
}
export function musicPatch(before:EDL,bgm:Bgm,assets:Asset[]):Patch{
 const edl=validateEDL({...structuredClone(before),version:before.version+1,bgm},assets,before);
 const regions=revisionRegions(before,edl);
 return {id:randomUUID(),base_version:before.version,feedback:`设置背景音乐 ${bgm.title}`,summary:`全片配上 ${bgm.title} · 音量 ${Math.round(bgm.gain*100)}% · 从 ${(bgm.start_ms/1000).toFixed(1)} 秒开始，循环铺满、淡入淡出${bgm.ducking?'、人声避让':''}。仅调整 BGM，先试听前 8 秒。`,edl,scope:{kind:'global',clip_ids:before.clips.map(c=>c.id),basis:'仅修改全片背景音乐'},constraints:changeContract([],['bgm']),changes:describeChanges(before,edl,assets),regions,affected_ranges:regions.map(r=>r.before_range),requires_confirmation:true,created_at:new Date().toISOString()};
}
export function musicCredits(edl:EDL){const b=edl.bgm;return b?`${b.attribution}\n来源：${b.source_url}\n许可：${b.license} ${b.license_url}\n修改：节选、循环、响度调整、混音及淡入淡出。\n发布时请将署名与许可链接放入视频说明；无法署名的广告位须另行取得免署名许可。\n`:'';}
