import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {command} from './media.js';
import {config} from './settings.js';
import {assert,AppError} from './errors.js';
import type {Asset,Shot} from '../shared/types.js';

const localInput=(file:string)=>['-protocol_whitelist','file,pipe','-i',file];
export async function referenceDurations(asset:Asset):Promise<number[]> {
 assert(asset.duration_ms<=180000,'REFERENCE_TOO_LONG','参考片请控制在 3 分钟以内。',422);
 const {stderr}=await command('ffmpeg',['-hide_banner','-nostdin',...localInput(asset.file_path),'-an','-vf',"scale=160:-2,select='gt(scene,0.28)',showinfo",'-f','null','-']);
 const cuts=[0,...[...stderr.matchAll(/pts_time:([\d.]+)/g)].map(m=>Math.round(Number(m[1])*1000)).filter(n=>n>300&&n<asset.duration_ms-300),asset.duration_ms];
 return cuts.slice(1).map((n,i)=>n-cuts[i]).filter(n=>n>=300);
}
/** Detect measured energy onsets, not a made-up BPM or equal-length grid. */
export function energyBeats(samples:Float32Array,rate=8000):number[]{
 const hop=Math.round(rate*.02),energy:number[]=[];
 for(let i=0;i<samples.length;i+=hop){let sum=0;for(let j=i;j<Math.min(samples.length,i+hop);j++)sum+=samples[j]**2;energy.push(Math.sqrt(sum/hop));}
 const onset=energy.map((e,i)=>Math.max(0,e-(energy[i-1]||0))),beats:number[]=[];
 for(let i=2;i<onset.length-2;i++){const around=onset.slice(Math.max(0,i-25),i+26);const mean=around.reduce((a,b)=>a+b,0)/around.length;const t=i*20;if(onset[i]>.006&&onset[i]>mean*2.3&&onset[i]>=onset[i-1]&&onset[i]>=onset[i+1]&&t-(beats.at(-1)??-1000)>=240)beats.push(t);}
 return beats;
}
export async function musicBeats(file:string,startMs:number,durationMs:number):Promise<number[]> {
 const dir=await mkdtemp(path.join(tmpdir(),'cutflow-beats-'));
 try{const out=path.join(dir,'samples.f32');await command('ffmpeg',['-hide_banner','-nostdin','-y','-stream_loop','-1',...localInput(file),'-ss',String(startMs/1000),'-t',String(durationMs/1000),'-vn','-ac','1','-ar','8000','-f','f32le',out]);const bytes=await readFile(out);const samples=new Float32Array(bytes.length/4);for(let i=0;i<samples.length;i++)samples[i]=bytes.readFloatLE(i*4);return energyBeats(samples);}finally{await rm(dir,{recursive:true,force:true});}
}
const Transcript=z.object({segments:z.array(z.object({start:z.number().nonnegative(),end:z.number().positive(),text:z.string().max(1500)})).min(1).max(3000)});
/** Use the configured provider only; never send audio to an implicit third party. */
export async function speechShots(asset:Asset):Promise<Shot[]> {
 const known=asset.shots.filter(s=>s.transcript?.trim());if(known.length)return asset.shots;
 assert(asset.has_audio,'SPEECH_REQUIRED',`${asset.name} 没有口播音轨，请添加有人声的素材。`,422);
 assert(config.apiKey,'ASR_NOT_CONFIGURED','此素材还没有逐字稿。请在设置中配置支持语音转写的模型服务，或在素材库填写带时间码的逐字稿。',409);
 const dir=await mkdtemp(path.join(tmpdir(),'cutflow-speech-'));
 try{
  const file=path.join(dir,'speech.mp3');await command('ffmpeg',['-hide_banner','-nostdin','-y',...localInput(asset.file_path),'-vn','-ac','1','-ar','16000','-b:a','32k',file]);
  const form=new FormData();form.set('file',new Blob([await readFile(file)],{type:'audio/mpeg'}),'speech.mp3');form.set('model',process.env.ASR_MODEL||'whisper-1');form.set('response_format','verbose_json');form.set('timestamp_granularities[]','segment');
  const response=await fetch(`${config.baseUrl}/audio/transcriptions`,{method:'POST',headers:{Authorization:`Bearer ${config.apiKey}`},body:form,redirect:'error',signal:AbortSignal.timeout(180000)}).catch(()=>{throw new AppError('ASR_UNREACHABLE','语音转写未连接成功，原素材已保留。',502);});
  assert(response.ok,'ASR_FAILED',`语音服务返回 ${response.status}，请检查服务是否支持 audio/transcriptions。`,502);
  const transcript=Transcript.parse(await response.json());
  const protectedShots=asset.shots.filter(s=>s.intent);
  const shots:Shot[]=transcript.segments.map((s,i)=>({id:`${asset.id}-speech-${i}`,asset_id:asset.id,start_ms:Math.max(0,Math.round(s.start*1000)),end_ms:Math.min(asset.duration_ms,Math.round(s.end*1000)),summary:s.text.trim(),transcript:s.text.trim(),evidence:{type:'model_audio' as const,description:'语音服务的逐句转写与时间码，需在文字方案中核对。',confidence:.85}})).filter(s=>s.end_ms-s.start_ms>=100&&!protectedShots.some(p=>s.start_ms<p.end_ms&&s.end_ms>p.start_ms));
  assert(shots.length||protectedShots.length,'SPEECH_NOT_FOUND','未识别到可用口播，请检查音轨或补充逐字稿。',422);
  return [...shots,...protectedShots].sort((a,b)=>a.start_ms-b.start_ms);
 }finally{await rm(dir,{recursive:true,force:true});}
}
