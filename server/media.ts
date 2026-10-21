import {createHash, randomUUID} from 'node:crypto';
import {createReadStream, existsSync} from 'node:fs';
import {copyFile, mkdir, readFile, realpath, rename, rm, stat, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {narrationAudio} from './skill-voice.js';
import {EDLSchema, durationOf, type Asset, type EDL, type QAReport, type RenderResult} from '../shared/types';

const require = createRequire(import.meta.url);
const TIMEOUT = 10 * 60 * 1000;
const ENGINE_VERSION = 'cutflow-media-v7';
const allowedContainers = new Set(['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2', 'matroska', 'webm', 'avi', 'mpeg', 'mpegts']);
export type RenderOptions = {quality: 'preview'|'final'; renderer?: string; signal?: AbortSignal; musicPath?:string; timelineOffsetMs?:number; fullDurationMs?:number; onProgress?: (value:number, message:string)=>void};

function binary(kind:'ffmpeg'|'ffprobe'): string {
  const candidate = kind === 'ffmpeg' ? (process.env.FFMPEG_PATH || require('ffmpeg-static')) : (process.env.FFPROBE_PATH || require('ffprobe-static').path);
  if (typeof candidate !== 'string' || !existsSync(candidate)) throw new Error(`${kind} 不可用，请先运行 npm install 或配置 ${kind.toUpperCase()}_PATH`);
  return candidate;
}
function abortError() { return Object.assign(new Error('渲染已取消'), {name:'AbortError'}); }
function checkAbort(signal?:AbortSignal) { if (signal?.aborted) throw abortError(); }

/** No shell, local inputs only, bounded diagnostics, hard timeout and cancellation. */
export async function command(kind:'ffmpeg'|'ffprobe', args:string[], options:{signal?:AbortSignal; timeout?:number} = {}) {
  checkAbort(options.signal);
  return new Promise<{stdout:string;stderr:string}>((resolve,reject) => {
    const child = spawn(binary(kind), args, {stdio:['ignore','pipe','pipe'], shell:false});
    let stdout = '', stderr = '', stopped:Error|undefined;
    const stop = (error:Error) => { stopped = error; child.kill('SIGKILL'); };
    const timer = setTimeout(() => stop(new Error(`${kind} 处理超时`)), options.timeout ?? TIMEOUT);
    const abort = () => stop(abortError());
    options.signal?.addEventListener('abort', abort, {once:true});
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-8_000_000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8_000_000); });
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
    child.on('error', error => {cleanup(); reject(error);});
    child.on('close', code => {cleanup(); if(stopped) reject(stopped); else if(code !== 0) reject(new Error(`${kind} 执行失败 (${code}): ${stderr.slice(-3500)}`)); else resolve({stdout,stderr});});
  });
}
async function localFile(filePath:string) {
  if (!path.isAbsolute(filePath) || filePath.includes('\0')) throw new Error('媒体路径必须是本地绝对路径');
  const resolved = await realpath(filePath);
  if (!(await stat(resolved)).isFile()) throw new Error('媒体源必须是文件');
  return resolved;
}
const ffmpegBase = ['-hide_banner','-nostdin','-y'];
const demuxers = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpeg,mpegts';
const input = (filePath:string) => ['-protocol_whitelist','file,pipe','-format_whitelist',demuxers,'-i',filePath];

export async function hashFile(filePath:string):Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(await localFile(filePath))) hash.update(chunk);
  return hash.digest('hex');
}
const audioInput=(file:string)=>['-protocol_whitelist','file,pipe','-format_whitelist','mp3,wav,mov,mp4,m4a,3gp,3g2,mj2,aac,ogg,flac','-i',file];
export async function probeMusic(filePath:string) {
  const file=await localFile(filePath);
  const {stdout}=await command('ffprobe',['-v','error',...audioInput(file).slice(0,-2),'-show_format','-show_streams','-of','json',file],{timeout:30000});
  const data=JSON.parse(stdout),seconds=Number(data.format?.duration);
  if(!data.streams?.some((s:{codec_type:string})=>s.codec_type==='audio')||!Number.isFinite(seconds)||seconds<1||seconds>1200)throw new Error('配乐须为 1 秒至 20 分钟的音频文件');
  const {stderr}=await command('ffmpeg',['-hide_banner','-nostdin',...audioInput(file),'-vn','-af','volumedetect','-f','null','-'],{timeout:60000});
  const peak=Number(stderr.match(/max_volume:\s*(-?[\d.]+|-inf) dB/)?.[1]);
  if(!Number.isFinite(peak)||peak<-55)throw new Error('配乐没有可听见的声音，请更换音频');
  return {duration_ms:Math.round(seconds*1000)};
}

/** Mix after picture rendering so both renderers use the same music and cache policy. */
async function mixMusic(video:string,edl:EDL,seconds:number,options:RenderOptions) {
  const bgm=edl.bgm!;
  if(!options.musicPath)throw new Error('配乐文件缺失，请重新选择 BGM');
  const source=await localFile(options.musicPath);
  if(await hashFile(source)!==bgm.sha256)throw new Error('配乐内容已变化，请重新选择并确认方案');
  const full=(options.fullDurationMs??seconds*1000)/1000,offset=(options.timelineOffsetMs??0)/1000;
  const temp=video.replace(/\.mp4$/,'.mixed.mp4');
  // Build the envelope on the full timeline before slicing a patch preview.
  const music=`[1:a]aresample=48000,atrim=start=${bgm.start_ms/1000}:duration=${full},asetpts=PTS-STARTPTS,loudnorm=I=-18:TP=-2:LRA=7,aresample=48000,volume=${bgm.gain},afade=t=in:d=${Math.min(.4,full/3)},afade=t=out:st=${Math.max(0,full-.8)}:d=${Math.min(.8,full)},atrim=start=${offset}:duration=${seconds},asetpts=PTS-STARTPTS[music]`;
  const mix=bgm.ducking?'[0:a]asplit=2[voice][side];[music][side]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350[bed];[voice][bed]':'[0:a][music]';
  try {
    await command('ffmpeg',[...ffmpegBase,...input(video),'-stream_loop','-1',...audioInput(source),'-filter_complex',`${music};${mix}amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89:level=false:latency=true[out]`,'-map','0:v:0','-map','[out]','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-t',String(seconds),'-metadata',`comment=${bgm.attribution}\nSource: ${bgm.source_url}\nAdapted: excerpt, loop, mixing and fades.`,'-movflags','+faststart',temp],{signal:options.signal});
    await rename(temp,video);
  } finally {await rm(temp,{force:true});}
}
export async function probeMedia(filePath:string):Promise<{duration_ms:number;width:number;height:number;fps:number;has_audio:boolean}> {
  const resolved = await localFile(filePath);
  const {stdout} = await command('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-format_whitelist',demuxers,'-show_format','-show_streams','-of','json',resolved],{timeout:60_000});
  const data = JSON.parse(stdout);
  const formats = String(data.format?.format_name ?? '').split(',');
  if (!formats.some((name:string)=>allowedContainers.has(name))) throw new Error('不支持此媒体容器；仅接受本地视频文件');
  const video = data.streams?.find((s:{codec_type:string;disposition?:{attached_pic:number}})=>s.codec_type==='video' && !s.disposition?.attached_pic);
  if (!video) throw new Error('媒体没有可用的视频轨道');
  const duration = Number(data.format?.duration || video.duration);
  const [numerator,denominator] = String(video.avg_frame_rate || video.r_frame_rate || '0/1').split('/').map(Number);
  const fps = denominator ? numerator / denominator : 0;
  if (!Number.isFinite(duration) || duration<=0 || duration>3600 || !video.width || !video.height || video.width>8192 || video.height>8192) throw new Error('视频时长或分辨率超出支持范围（最长 60 分钟，最大 8192 像素）');
  if (!Number.isFinite(fps) || fps<=0 || fps>240) throw new Error('无效或不支持的视频帧率');
  return {duration_ms:Math.round(duration*1000),width:video.width,height:video.height,fps,has_audio:data.streams.some((s:{codec_type:string})=>s.codec_type==='audio')};
}

export async function ingestVideo(filePath:string, originalName:string, assetsDir:string):Promise<Asset> {
  const source = await localFile(filePath);
  const metadata = await probeMedia(source);
  const sha256 = await hashFile(source), id = sha256.slice(0,24);
  const extension = path.extname(originalName).toLowerCase();
  const ext = ['.mp4','.mov','.mkv','.webm','.avi','.m4v','.ts','.mpeg','.mpg'].includes(extension) ? extension : '.mp4';
  const directory = path.resolve(assetsDir,id), destination = path.join(directory,`source${ext}`);
  await mkdir(directory,{recursive:true});
  if (!existsSync(destination)) await copyFile(source,destination);
  // Copies are verified before registration; originals are never changed.
  if (await hashFile(destination)!==sha256) throw new Error('素材副本哈希验证失败');
  const thumbnail = path.join(directory,'thumbnail.jpg');
  if (!existsSync(thumbnail)) await command('ffmpeg',[...ffmpegBase,'-ss',String(Math.min(1,metadata.duration_ms/2000)),...input(destination),'-frames:v','1','-vf','scale=480:-2','-q:v','3',thumbnail],{timeout:60_000});
  return {id,name:path.basename(originalName).slice(0,240),file_path:destination,url:`/media/assets/${id}/source${ext}`,thumbnail_url:`/media/assets/${id}/thumbnail.jpg`,...metadata,sha256,created_at:new Date().toISOString(),shots:[{id:`${id}-source`,asset_id:id,start_ms:0,end_ms:metadata.duration_ms,summary:`${path.basename(originalName)} · 完整素材（尚未做视觉或语音分析）`,evidence:{type:'metadata',description:'ffprobe 实测时长、尺寸和音轨；未识别画面内容或对白。',confidence:1}}],warnings:['当前素材分段来自完整文件元数据；画面内容与对白需要模型分析或人工标注。',...(!metadata.has_audio?['该素材无原声音轨；成片使用选定的背景音乐。']:[])]};
}

export function outputDimensions(edl:EDL,quality:'preview'|'final') {
  const side = quality==='preview' || edl.resolution==='720p' ? 720 : 1080;
  return edl.aspect_ratio==='9:16' ? {width:side,height:side*16/9} : edl.aspect_ratio==='16:9' ? {width:side*16/9,height:side} : {width:side,height:side};
}
const framesFor = (clip:EDL['clips'][number],fps:number) => Math.max(1,Math.round((clip.end_ms-clip.start_ms)*fps/1000));
const timecode = (milliseconds:number) => { const ms=Math.round(milliseconds); return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`; };
const plainText = (text:string) => text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/\r/g,'');
export function subtitlesFor(edl:EDL):string {
  let offset=0,index=1; const entries:string[]=[];
  for(const clip of edl.clips) { const end=offset+framesFor(clip,edl.fps)*1000/edl.fps; if(edl.subtitles&&clip.caption.trim()) entries.push(`${index++}\n${timecode(offset)} --> ${timecode(end)}\n${plainText(clip.caption).replace(/\n{2,}/g,'\n')}\n`); offset=end; }
  return entries.join('\n');
}
function fontFile() {
  return ['/System/Library/Fonts/PingFang.ttc','/System/Library/Fonts/STHeiti Medium.ttc','/Library/Fonts/Arial Unicode.ttf','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find(existsSync);
}
function escapeFilterPath(filePath:string) { return filePath.replace(/\\/g,'\\\\').replace(/:/g,'\\:').replace(/'/g,"'\\''"); }
function wrapText(text:string,maxWidth:number) {
  const lines:string[]=[]; let line='',width=0;
  for(const char of Array.from(plainText(text))) { const next=/[\u0000-\u00ff]/.test(char)?0.55:1; if(char==='\n'||width+next>maxWidth) {lines.push(line);line='';width=0;} if(char!=='\n'){line+=char;width+=next;} }
  if(line)lines.push(line); return lines.join('\n');
}
async function textFilter(text:string,filePath:string,width:number,height:number,placement:'caption'|'cta'|'title',emphasis=false,offsetMs=0) {
  const font=fontFile(); if(!font)throw new Error('未找到字幕字体，请安装 Noto Sans CJK');
  const fontsize=Math.round(Math.min(width,height)*(placement==='cta'?0.049:0.043));
  await writeFile(filePath,wrapText(text,Math.floor(width*0.82/fontsize)),'utf8');
  const y=placement==='caption'?'h-text_h-h*0.14':placement==='cta'?'h*0.15':'h*0.035';
  return `drawtext=fontfile='${escapeFilterPath(font)}':textfile='${escapeFilterPath(filePath)}':expansion=none:fontcolor=${emphasis?'0xF3F8AE':'white'}:fontsize=${Math.round(fontsize*(emphasis?1.14:1))}:line_spacing=${Math.round(fontsize*0.28)}:box=1:boxcolor=black@0.6:boxborderw=${Math.round(fontsize*0.4)}:x=(w-text_w)/2:y=${emphasis?`h-text_h-h*0.14+12*max(0\\,1-(t+${offsetMs/1000})/0.18)`:y}${emphasis?`:alpha='min(1,(t+${offsetMs/1000})/0.12)'`:''}`;
}

export async function renderVideo(inputEdl:EDL, assets:Asset[], outputDir:string, options:RenderOptions):Promise<RenderResult> {
  const edl=EDLSchema.parse(inputEdl), renderer=options.renderer||'ffmpeg';
  if(!['ffmpeg','remotion'].includes(renderer))throw new Error(`不支持的渲染器: ${renderer}`);
  checkAbort(options.signal);
  if(durationOf(edl)>180_000)throw new Error('单次输出最长 180 秒');
  const map=new Map(assets.map(asset=>[asset.id,asset]));
  const selected:Asset[]=[];
  for(const clip of edl.clips) {
    const asset=map.get(clip.asset_id);
    if(!asset)throw new Error(`EDL 引用了未授权素材 ${clip.asset_id}`);
    if(clip.end_ms<=clip.start_ms||clip.end_ms>asset.duration_ms+1)throw new Error(`片段 ${clip.id} 的入出点超出素材范围`);
    if(!selected.some(a=>a.id===asset.id))selected.push(asset);
    if(clip.audio_source){const voice=map.get(clip.audio_source.asset_id);if(!voice?.has_audio||clip.audio_source.start_ms<0||clip.audio_source.end_ms>voice.duration_ms)throw new Error('独立口播区间无效');if(!selected.some(a=>a.id===voice.id))selected.push(voice);}
  }
  for(const asset of selected)if(await hashFile(asset.file_path)!==asset.sha256)throw new Error(`素材 ${asset.name} 的哈希已改变，请重新导入`);
  const directory=path.resolve(outputDir); await mkdir(directory,{recursive:true});
  const {width,height}=outputDimensions(edl,options.quality);
  // Source copies use <assets>/<id>/source.ext. Cache is shared across task versions.
  const cacheDir=path.resolve(path.dirname(path.dirname(selected[0].file_path)),'..','.render-cache');
  await mkdir(cacheDir,{recursive:true});
  const segments:{file:string;frames:number;caption:string;title:string;cta:string}[]=[];
  let cacheHits=0;
  options.onProgress?.(3,'验证素材并编译受控时间线');
  for(let i=0;i<edl.clips.length;i++) {
    checkAbort(options.signal);
    const clip=edl.clips[i],asset=map.get(clip.asset_id)!,frames=framesFor(clip,edl.fps),seconds=frames/edl.fps;
    const caption=edl.subtitles?clip.caption:'',title=edl.subtitles&&i===0?edl.title:'',cta=edl.subtitles&&i===edl.clips.length-1?edl.cta:'';
    const key=createHash('sha256').update(JSON.stringify({engine:ENGINE_VERSION,source:asset.sha256,start:clip.start_ms,frames,width,height,fps:edl.fps,gain:edl.audio_gain*(clip.audio_gain??1),narration:clip.narration,audio_source:clip.audio_source,audio_hash:clip.audio_source?map.get(clip.audio_source.asset_id)?.sha256:undefined,caption_style:edl.caption_style,caption_offset_ms:clip.caption_offset_ms,quality:options.quality,overlay:renderer==='ffmpeg'||edl.caption_style==='emphasis'?{caption,title,cta}:null})).digest('hex');
    const segment=path.join(cacheDir,`${key}.mkv`);
    if(existsSync(segment)) { try { const m=await probeMedia(segment); if(Math.abs(m.duration_ms-seconds*1000)>120||m.width!==width||m.height!==height)throw new Error('bad cache'); cacheHits++; } catch { await rm(segment,{force:true}); } }
    if(!existsSync(segment)) {
      const temp=path.join(cacheDir,`${key}-${randomUUID()}.mkv`);
      // Seeking into a 23.976 fps source can leave the first frame at a nonzero PTS.
      // Reset before conversion and trim by frame count, otherwise each fractional cut
      // can lose one frame and concatenate with a gap against its audio/subtitle clock.
      const videoFilters=['setpts=PTS-STARTPTS',`scale=${width}:${height}:force_original_aspect_ratio=decrease`,`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,'setsar=1',`fps=${edl.fps}`,`tpad=stop_mode=clone:stop_duration=${seconds}`,`trim=end_frame=${frames}`,`setpts=N/(${edl.fps}*TB)`];
      if(renderer==='ffmpeg'||edl.caption_style==='emphasis') {
        if(caption)videoFilters.push(await textFilter(caption,path.join(cacheDir,`${key}-caption.txt`),width,height,'caption',edl.caption_style==='emphasis',clip.caption_offset_ms));
        if(title)videoFilters.push(await textFilter(title,path.join(cacheDir,`${key}-title.txt`),width,height,'title'));
        if(cta)videoFilters.push(await textFilter(cta,path.join(cacheDir,`${key}-cta.txt`),width,height,'cta'));
      }
      const args=[...ffmpegBase,'-ss',(clip.start_ms/1000).toFixed(6),...input(await localFile(asset.file_path))];
      let audioMap=asset.has_audio?'0:a:0':'1:a:0';
      if(clip.narration){const voiceKey=createHash('sha256').update(JSON.stringify({text:clip.narration.text,language:clip.narration.language,duration:clip.narration.full_duration_ms??Math.round(seconds*1000)})).digest('hex');const voiceDir=path.join(cacheDir,`voice-${voiceKey}`);await mkdir(voiceDir,{recursive:true});const voice=await narrationAudio(clip.narration,voiceDir,(clip.narration.full_duration_ms??seconds*1000)/1000,options.signal);args.push('-ss',String((clip.narration.offset_ms||0)/1000),...audioInput(voice));audioMap='1:a:0';}
      else if(clip.audio_source){const voice=map.get(clip.audio_source.asset_id);if(!voice?.has_audio)throw new Error('独立音轨素材不可用');if(await hashFile(voice.file_path)!==voice.sha256)throw new Error('口播源文件已变化');args.push('-ss',String(clip.audio_source.start_ms/1000),...input(await localFile(voice.file_path)));audioMap='1:a:0';}
      else if(!asset.has_audio)args.push('-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000');
      args.push('-map','0:v:0','-map',audioMap,'-vf',videoFilters.join(','),'-af',`asetpts=PTS-STARTPTS,aresample=48000,volume=${edl.audio_gain*(clip.audio_gain??1)},apad,atrim=duration=${seconds}`,'-t',String(seconds),'-r',String(edl.fps),'-c:v','libx264','-preset',options.quality==='preview'?'ultrafast':'fast','-crf',options.quality==='preview'?'25':'20','-pix_fmt','yuv420p','-c:a','pcm_s16le','-ac','2','-ar','48000','-threads','2',temp);
      try {await command('ffmpeg',args,{signal:options.signal}); await rename(temp,segment);} catch(error){await rm(temp,{force:true});throw error;}
    }
    segments.push({file:segment,frames,caption,title,cta});
    options.onProgress?.(5+Math.round((i+1)/edl.clips.length*65),`片段 ${i+1}/${edl.clips.length}${cacheHits?' · 已复用 '+cacheHits+' 段缓存':''}`);
  }
  const videoPath=path.join(directory,`${options.quality}.mp4`),temporaryVideo=path.join(directory,`.${options.quality}-${randomUUID()}.mp4`);
  const totalSeconds=segments.reduce((s,c)=>s+c.frames,0)/edl.fps;
  try {
    if(renderer==='remotion'&&edl.caption_style!=='emphasis') {
      const {renderComposition}=await import('./remotion/adapter');
      await renderComposition(segments,{width,height,fps:edl.fps,output:temporaryVideo,quality:options.quality,signal:options.signal,onProgress:progress=>options.onProgress?.(70+Math.round(progress*24),'Remotion 逐帧渲染')});
    } else {
      const concatFile=path.join(directory,`.concat-${randomUUID()}.txt`);
      // Only controlled SHA-256 filenames occur in this file; no EDL paths or URLs.
      await writeFile(concatFile,segments.map(s=>`file '${s.file.replace(/'/g,"'\\''")}'\nduration ${s.frames/edl.fps}`).join('\n'));
      try { await command('ffmpeg',[...ffmpegBase,'-protocol_whitelist','file,pipe','-f','concat','-safe','0','-i',concatFile,'-map','0:v:0','-map','0:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-t',String(totalSeconds),'-movflags','+faststart',temporaryVideo],{signal:options.signal}); } finally { await rm(concatFile,{force:true}); }
    }
    if(edl.bgm){options.onProgress?.(94,'铺设背景音乐、淡入淡出并混合人声');await mixMusic(temporaryVideo,edl,totalSeconds,options);}
    checkAbort(options.signal); await rename(temporaryVideo,videoPath);
  } catch(error) {await rm(temporaryVideo,{force:true});throw error;}
  const subtitlePath=path.join(directory,`${options.quality}.srt`),coverPath=path.join(directory,`${options.quality}-cover.jpg`);
  await writeFile(subtitlePath,subtitlesFor(edl),'utf8');
  await command('ffmpeg',[...ffmpegBase,'-ss',String(Math.min(0.5,totalSeconds/2)),...input(videoPath),'-frames:v','1','-q:v','2',coverPath],{signal:options.signal,timeout:60_000});
  const metadata=await probeMedia(videoPath),sha256=await hashFile(videoPath);
  options.onProgress?.(96,'输出完成，准备技术质检');
  return {video_path:videoPath,cover_path:coverPath,subtitle_path:subtitlePath,duration_ms:metadata.duration_ms,width:metadata.width,height:metadata.height,fps:metadata.fps,sha256,cache_hits:cacheHits,renderer};
}

export async function evaluateRender(result:RenderResult,edl:EDL,quality:'preview'|'final',options:{allowSilentComparison?:boolean}={}):Promise<QAReport> {
  const checks:QAReport['checks']=[],issues:QAReport['issues']=[];
  const fail=(name:string,code:string,message:string,evidence:string)=>{checks.push({name,status:'fail',detail:message});issues.push({code,severity:'error',message,evidence,repairability:'deterministic_safe'});};
  try {
    const metadata=await probeMedia(result.video_path),dimensions=outputDimensions(edl,quality),expected=edl.clips.reduce((s,c)=>s+framesFor(c,edl.fps)*1000/edl.fps,0);
    const valid=metadata.width===dimensions.width&&metadata.height===dimensions.height&&Math.abs(metadata.fps-edl.fps)<0.05;
    if(valid)checks.push({name:'输出规格',status:'pass',detail:`实测 ${metadata.width}×${metadata.height} / ${metadata.fps.toFixed(2)} fps`});else fail('输出规格','OUTPUT_SPEC','实测分辨率或帧率与 EDL 不一致',JSON.stringify(metadata));
    if(Math.abs(metadata.duration_ms-expected)<=Math.max(120,1000/edl.fps*2))checks.push({name:'输出时长',status:'pass',detail:`实测 ${metadata.duration_ms} ms，帧对齐预期 ${Math.round(expected)} ms`});else fail('输出时长','DURATION_MISMATCH','输出时长偏离时间线',`${metadata.duration_ms} vs ${expected}`);
    if(metadata.has_audio)checks.push({name:'音频轨道',status:'pass',detail:'输出包含标准音频轨道；实际可听性见声音检测'});else fail('音频轨道','MISSING_AUDIO','输出缺少标准化音频轨道','ffprobe has_audio=false');
    if(await hashFile(result.video_path)===result.sha256)checks.push({name:'产物完整性',status:'pass',detail:'SHA-256 与渲染结果一致'});else fail('产物完整性','HASH_MISMATCH','输出文件哈希不一致','SHA-256 mismatch');
  } catch(error) { fail('文件探测','PROBE_FAILED','无法读取输出文件',String(error)); }
  try {
    const {stderr}=await command('ffmpeg',['-hide_banner','-nostdin','-v','info','-xerror',...input(await localFile(result.video_path)),'-vf','blackdetect=d=0.35:pix_th=0.10:pic_th=0.98','-af','volumedetect','-f','null','-'],{timeout:TIMEOUT});
    checks.push({name:'全片可解码',status:'pass',detail:'FFmpeg 已解码全部视频与音频帧（-xerror）'});
    const black=Array.from(stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g));
    if(black.length){checks.push({name:'连续黑帧',status:'fail',detail:`检测到 ${black.length} 段持续至少 0.35 秒的近全黑画面`});for(const m of black)issues.push({code:'BLACK_FRAMES',severity:'warning',message:'连续黑帧需要检查是否为预期画面',time_range:[Number(m[1])*1000,Number(m[2])*1000],evidence:m[0],repairability:'human_review'});}
    else checks.push({name:'连续黑帧',status:'pass',detail:'未检出持续 ≥0.35 秒、≥98% 像素近黑的画面；黑边不等于黑帧'});
    const peak=stderr.match(/max_volume:\s*(-?[\d.]+|-inf) dB/);
    const mean=stderr.match(/mean_volume:\s*(-?[\d.]+|-inf) dB/);
    const audible=!!peak&&Number(peak[1])>-55&&!!mean&&Number(mean[1])>-65;
    if(audible)checks.push({name:'可听声音',status:'pass',detail:`平均 ${mean![1]} dBFS，峰值 ${peak![1]} dBFS`});
    else if(options.allowSilentComparison)checks.push({name:'可听声音',status:'manual',detail:'旧版对照片段无声，仅供修改前后比较；新版与交付仍须通过可听检查'});
    else fail('可听声音','SILENT_OUTPUT','视频没有可听见的声音，请添加或调整 BGM','音轨存在不代表有声音');
    if(!peak)fail('音频峰值','AUDIO_MEASUREMENT_FAILED','未能测量音频峰值','volumedetect 未返回 max_volume');
    else if(Number(peak[1])>=-0.1){checks.push({name:'音频峰值',status:'fail',detail:`采样峰值 ${peak[1]} dBFS，存在削波风险`});issues.push({code:'AUDIO_PEAK',severity:'warning',message:'音频接近满刻度，请试听或降低音量',evidence:peak[0],repairability:'human_review'});}
    else checks.push({name:'音频峰值',status:'pass',detail:`采样峰值 ${peak[1]} dBFS（非真峰值测量）`});
  } catch(error) {fail('全片可解码与信号检测','DECODE_FAILED','全片解码或黑帧/音频检测失败',String(error));}
  try {const srt=await readFile(result.subtitle_path,'utf8');if(srt!==subtitlesFor(edl))throw new Error('字幕与 EDL 不一致');checks.push({name:'字幕时间文件',status:'pass',detail:edl.subtitles?'SRT 与帧对齐时间线一致':'EDL 已关闭字幕，SRT 为空'});} catch(error){fail('字幕时间文件','SUBTITLE_FILE_FAILED','字幕文件校验失败',String(error));}
  checks.push({name:'内容与视觉人工审核',status:'manual',detail:'字幕语义、字体缺字/遮挡、镜头内容与节奏、品牌与版权/合规尚未自动验证，需人工确认。技术检查通过不代表内容审核通过。'});
  return {passed:!checks.some(check=>check.status==='fail'),checks,issues,checked_at:new Date().toISOString()};
}

export async function generateDemoAssets(assetsDir:string):Promise<Asset[]> {
  const demoDir=path.resolve(assetsDir,'..','.demo-sources');await mkdir(demoDir,{recursive:true});
  const patterns=['testsrc2=size=640x360:rate=30','smptebars=size=640x360:rate=30','color=c=0x123745:size=640x360:rate=30'];
  const assets:Asset[]=[];
  for(let i=0;i<patterns.length;i++){
    const file=path.join(demoDir,`demo-${i+1}.mp4`);
    if(!existsSync(file)){
      const args=[...ffmpegBase,'-f','lavfi','-i',patterns[i]];
      if(i<2)args.push('-f','lavfi','-i',`sine=frequency=${440+i*220}:sample_rate=48000`);
      const font=fontFile();
      if(font)args.push('-vf',`drawtext=fontfile='${escapeFilterPath(font)}':text='DEMO ${i+1} - SYNTHETIC TEST VIDEO':fontcolor=white:fontsize=22:box=1:boxcolor=black@0.7:boxborderw=14:x=(w-text_w)/2:y=(h-text_h)/2`);
      args.push('-t','5','-c:v','libx264','-preset','ultrafast','-crf','25','-pix_fmt','yuv420p','-threads','2');
      if(i<2)args.push('-c:a','aac','-b:a','128k');
      args.push('-movflags','+faststart',file);await command('ffmpeg',args,{timeout:60_000});
    }
    const asset=await ingestVideo(file,`演示测试图案 ${i+1}.mp4`,assetsDir);
    asset.shots=asset.shots.map(shot=>({...shot,summary:`合成测试图案 ${i+1}（非用户真实素材）`,evidence:{type:'demo' as const,description:'由 FFmpeg lavfi 生成的合成测试图案；仅用于验证剪辑与渲染管线。',confidence:1}}));
    asset.warnings=['DEMO：本素材由程序生成，不是真实商品、人物或拍摄素材。',...(i===2?['此演示素材无声，验证静音补轨。']:[])];assets.push(asset);
  }
  return assets;
}

/** Bounded, ordered source frames for a reviewable temporal-analysis proposal. */
export async function sampleActionFrames(filePath:string,durationMs:number,outputDir:string):Promise<{time_ms:number;path:string}[]> {
  const file=await localFile(filePath);await mkdir(outputDir,{recursive:true});
  const count=Math.min(16,Math.max(4,Math.ceil(durationMs/750)));
  const last=Math.max(0,durationMs-100),samples:{time_ms:number;path:string}[]=[];
  for(let i=0;i<count;i++){
    const time_ms=Math.round(i*last/(count-1)),frame=path.join(outputDir,`${time_ms}.jpg`);
    if(!existsSync(frame))await command('ffmpeg',[...ffmpegBase,'-ss',String(time_ms/1000),...input(file),'-frames:v','1','-vf','scale=640:640:force_original_aspect_ratio=decrease','-q:v','3',frame],{timeout:30000});
    samples.push({time_ms,path:frame});
  }
  return samples;
}
