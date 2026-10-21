import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import type {AddressInfo} from 'node:net';
import type {CompositionProps} from './props';

let bundlePromise:Promise<string>|undefined;
async function getBundle() {
  if(!bundlePromise) {
    bundlePromise=(async()=>{
      const {bundle}=await import('@remotion/bundler');
      return bundle({entryPoint:fileURLToPath(new URL('./entry.tsx',import.meta.url)),rootDir:fileURLToPath(new URL('../../',import.meta.url)),publicDir:null,enableCaching:true});
    })().catch(error=>{bundlePromise=undefined;throw error;});
  }
  return bundlePromise;
}
interface Segment {file:string;frames:number;caption:string;title:string;cta:string}
interface Options {width:number;height:number;fps:number;output:string;quality:'preview'|'final';signal?:AbortSignal;onProgress?:(value:number)=>void}

/** Real Remotion compilation and rendering; failures are surfaced, never silently rerouted. */
export async function renderComposition(segments:Segment[],options:Options) {
  if(options.signal?.aborted)throw Object.assign(new Error('渲染已取消'),{name:'AbortError'});
  const token=randomUUID();
  const routes=new Map(segments.map((segment,i)=>[`/${token}/${i}.mkv`,segment.file]));
  // The temporary local server exposes only the controlled normalized cache files.
  const server=createServer(async(request,response)=>{
    if(request.method!=='GET'&&request.method!=='HEAD'){response.writeHead(405);response.end();return;}
    const file=routes.get(request.url||'');
    if(!file){response.writeHead(404);response.end();return;}
    try {
      const {size}=await stat(file),range=request.headers.range;
      const headers={'Content-Type':'video/x-matroska','Access-Control-Allow-Origin':'*','Accept-Ranges':'bytes'};
      if(range){
        const match=/^bytes=(\d+)-(\d*)$/.exec(range);
        if(!match){response.writeHead(416,{'Content-Range':`bytes */${size}`});response.end();return;}
        const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),size-1):size-1;
        if(start>=size||end<start){response.writeHead(416,{'Content-Range':`bytes */${size}`});response.end();return;}
        response.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1});
        if(request.method==='HEAD')response.end();else {const stream=createReadStream(file,{start,end});stream.on('error',()=>response.destroy());response.on('close',()=>stream.destroy());stream.pipe(response);}
      } else {
        response.writeHead(200,{...headers,'Content-Length':size});
        if(request.method==='HEAD')response.end();else {const stream=createReadStream(file);stream.on('error',()=>response.destroy());response.on('close',()=>stream.destroy());stream.pipe(response);}
      }
    }catch{response.writeHead(500);response.end();}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const props:CompositionProps={width:options.width,height:options.height,fps:options.fps,clips:segments.map((segment,index)=>({src:`${base}/${token}/${index}.mkv`,frames:segment.frames,caption:segment.caption,title:segment.title,cta:segment.cta}))};
  let cleanup=()=>{};
  try {
    const serveUrl=await getBundle();
    if(options.signal?.aborted)throw Object.assign(new Error('渲染已取消'),{name:'AbortError'});
    const {selectComposition,renderMedia,makeCancelSignal}=await import('@remotion/renderer');
    const {cancel,cancelSignal}=makeCancelSignal();
    const timer=setTimeout(cancel,15*60*1000);
    options.signal?.addEventListener('abort',cancel,{once:true});
    cleanup=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);};
    const browserExecutable=process.env.REMOTION_BROWSER_EXECUTABLE;
    const composition=await selectComposition({serveUrl,id:'CutflowTimeline',inputProps:props,browserExecutable,timeoutInMilliseconds:60_000,logLevel:'error'});
    if(options.signal?.aborted)throw Object.assign(new Error('渲染已取消'),{name:'AbortError'});
    await renderMedia({composition,serveUrl,codec:'h264',outputLocation:options.output,inputProps:props,browserExecutable,cancelSignal,concurrency:2,crf:options.quality==='preview'?25:20,x264Preset:options.quality==='preview'?'ultrafast':'fast',pixelFormat:'yuv420p',audioCodec:'aac',audioBitrate:'192k',enforceAudioTrack:true,timeoutInMilliseconds:60_000,logLevel:'error',onProgress:({progress})=>options.onProgress?.(progress)});
  }catch(error){
    if(options.signal?.aborted)throw Object.assign(new Error('渲染已取消'),{name:'AbortError'});
    throw new Error(`Remotion 渲染失败（未自动降级）：${error instanceof Error?error.message:String(error)}。可明确选择 ffmpeg 渲染器后重试。`);
  }finally{
    cleanup();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
}
