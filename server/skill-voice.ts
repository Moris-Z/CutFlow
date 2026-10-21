import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {command} from './media.js';
import type {Clip} from '../shared/types.js';
const voices={zh:'zh-CN-XiaoxiaoNeural',en:'en-US-JennyNeural',ja:'ja-JP-NanamiNeural',es:'es-ES-ElviraNeural',fr:'fr-FR-DeniseNeural'};
export async function narrationAudio(narration:NonNullable<Clip['narration']>,directory:string,seconds:number,signal?:AbortSignal){
 const text=path.join(directory,'narration.txt'),mp3=path.join(directory,'narration.mp3'),wav=path.join(directory,'narration.wav');
 if(existsSync(wav)){const {stdout}=await command('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',wav],{signal});if(Math.abs(Number(stdout.trim())-seconds)<.05)return wav;}
 await writeFile(text,narration.text);
 const executable=process.env.CUTFLOW_TTS_BIN||path.resolve('.local/voice-env/bin/edge-tts');
 if(!existsSync(executable))throw new Error('在线配音组件未安装。请按 README 安装 edge-tts，或配置 CUTFLOW_TTS_BIN。');
 signal?.throwIfAborted();
 await new Promise<void>((resolve,reject)=>{
  const child=spawn(executable,['--voice',voices[narration.language],'--file',text,'--write-media',mp3],{shell:false,stdio:['ignore','ignore','pipe']});let error='';
  const stop=()=>child.kill('SIGKILL');const timer=setTimeout(stop,90000);signal?.addEventListener('abort',stop,{once:true});
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);};
  child.stderr.on('data',b=>error=(error+b).slice(-1000));child.on('error',e=>{cleanup();reject(e);});child.on('close',code=>{cleanup();if(code===0&&!signal?.aborted)resolve();else reject(new Error(`配音服务未完成：${error.slice(-300)}`));});
 });
 const {stdout}=await command('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',mp3],{signal});const duration=Number(stdout.trim());
 if(!Number.isFinite(duration)||duration<=0)throw new Error('配音没有生成有效声音，请重试。');
 const speed=Math.max(1,duration/seconds);if(speed>1.55)throw new Error('配音内容过长，无法在当前镜头内自然读完。请缩短配音文案或延长镜头后重新预览。');
 await command('ffmpeg',['-hide_banner','-nostdin','-y','-i',mp3,'-af',`atempo=${speed},apad,atrim=duration=${seconds}`,'-ar','48000','-ac','2',wav],{signal});
 const {stderr}=await command('ffmpeg',['-hide_banner','-nostdin','-i',wav,'-af','volumedetect','-f','null','-'],{signal});const peak=Number(stderr.match(/max_volume:\s*(-?[\d.]+|-inf) dB/)?.[1]);if(!Number.isFinite(peak)||peak<-55)throw new Error('配音没有可听见的声音，已停止生成。');
 return wav;
}
