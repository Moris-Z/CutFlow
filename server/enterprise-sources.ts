import {spawn} from 'node:child_process';
import path from 'node:path';
import {mkdir,readFile,writeFile,rename,stat} from 'node:fs/promises';
import type {SourceConnection,SearchSourceReport,SourceReference} from '../shared/types.js';
import type {StockCandidate} from './source-search.js';

export const DOUYIN_PROJECT='https://douyin-ai.bytedance.net/project/assist_7689858916037151526?_withType=true&space=%22douyin_experience%22';
export type CliRunner=(args:string[],options?:{cwd?:string;output?:string;timeout?:number})=>Promise<any>;
class LarkError extends Error {
 constructor(public kind:'auth'|'permission'|'unavailable'|'failed',message:string){super(message);}
}
function cliFailure(raw:string){
 let e:any;try{e=JSON.parse(raw).error;}catch{/* Do not surface raw CLI output or credentials. */}
 if(/missing_scope|permission|forbidden/i.test(String(e?.subtype)+' '+String(e?.type)))return new LarkError('permission','飞书检索或下载权限不足，请重新授权相应的只读权限。');
 if(/auth|token|login/i.test(String(e?.subtype)+' '+String(e?.type)))return new LarkError('auth','飞书用户登录已失效，请重新登录后重试。');
 return new LarkError('failed','飞书操作未完成，请检查连接后重试。');
}
/** Credentials stay inside the official CLI. No shell, bot fallback, remote cookies, or raw stderr in API responses. */
export const runLark:CliRunner=(args,options={})=>new Promise((resolve,reject)=>{
 const child=spawn('lark-cli',args,{shell:false,cwd:options.cwd,env:{...process.env,LARKSUITE_CLI_NO_UPDATE_NOTIFIER:'1',LARKSUITE_CLI_NO_SKILLS_NOTIFIER:'1'},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='',failure:Error|undefined;
 const stop=(e:Error)=>{failure=e;child.kill('SIGKILL');};
 const timer=setTimeout(()=>stop(new LarkError('failed','飞书请求超时，请稍后重试。')),options.timeout||30000);
 const sizeCheck=options.output?setInterval(()=>{void stat(options.output!).then(s=>{if(s.size>160*1024*1024)stop(new LarkError('failed','飞书视频超过 160 MB，已停止导入。'));}).catch(()=>{});},200):undefined;
 const clean=()=>{clearTimeout(timer);if(sizeCheck)clearInterval(sizeCheck);};
 child.stdout.on('data',c=>{stdout+=c.toString();if(Buffer.byteLength(stdout)>4_000_000)stop(new LarkError('failed','飞书返回内容过大，请缩小检索范围。'));});
 child.stderr.on('data',c=>{stderr=(stderr+c.toString()).slice(-16000);});
 child.on('error',()=>{clean();reject(new LarkError('unavailable','未找到可用的飞书 CLI，请检查本机安装。'));});
 child.on('close',code=>{clean();if(failure)return reject(failure);if(code!==0)return reject(cliFailure(stderr));try{const data=JSON.parse(stdout);if(data.ok===false)return reject(cliFailure(stdout));resolve(data);}catch{reject(new LarkError('failed','飞书返回格式无法识别，请检查 CLI 版本。'));}});
});
const plain=(s:unknown)=>typeof s==='string'?s.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;|&#34;/g,'"').replace(/&#39;|&apos;/g,"'").trim():'';
const videoName=(s:string)=>/\.(mp4|mov|m4v|webm|mkv|avi|ts|mpeg|mpg)$/i.test(s);
const validToken=(s:string)=>/^[A-Za-z0-9_-]{8,150}$/.test(s);
export function larkResource(value:string){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!/(^|\.)(feishu\.cn|larkoffice\.com|larksuite\.com)$/.test(u.hostname))return;
 const match=u.pathname.match(/^\/(?:drive\/)?(file|docx|wiki)\/([A-Za-z0-9_-]{8,150})\/?$/);if(!match)return;
 return {type:match[1],token:match[2],url:`${u.origin}${u.pathname}`};
 }catch{return;}
}
export function larkResults(data:any){
 const list=data?.results;if(!Array.isArray(list))throw new LarkError('failed','飞书搜索结果格式发生变化，需要更新连接器。');
 return list.map((r:any)=>{const m=r.result_meta||r;return {title:plain(m.title||m.title_highlighted||r.title||r.title_highlighted),resource:larkResource(m.url||r.url||'')};}).filter(r=>r.title&&r.resource);
}
export function documentVideos(content:string,parent:string,title:string):StockCandidate[]{
 const found:StockCandidate[]=[];
 for(const match of content.matchAll(/<source\b([^>]*)\/?\s*>/g)){
  const attrs=Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],plain(m[2])]));
  if(!validToken(attrs.token||'')||!videoName(attrs.name||''))continue;
  found.push({provider:'Feishu',usage:'enterprise_reference',title:attrs.name,description:`${title} 中的视频附件（尚未分析画面）`,source_url:parent+'#media-'+attrs.token,download_url:'',license_url:'',lark:{token:attrs.token,type:'media',parent_url:parent}});
 }
 return found;
}
/** Page links are useful references, never downloadable video files or visual evidence. */
export function documentReferences(content:string,parent:string,subject:string):SourceReference[]{
 const found:SourceReference[]=[];
 const normalize=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 const query=normalize(subject);if(!query)return [];
 for(const match of content.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)){
  const title=plain(match[2]);if(!normalize(title).includes(query))continue;
  try{const url=new URL(plain(match[1]));
   if(url.protocol!=='https:'||url.username||url.password||url.port||!['www.douyin.com','douyin.com'].includes(url.hostname)||!/^\/video\/\d{16,22}\/?$/.test(url.pathname))continue;
   found.push({provider:'Feishu',title:title.slice(0,240),url:`https://www.douyin.com${url.pathname}`,document_url:parent});
  }catch{/* Ignore non-video and unsafe links. */}
 }
 return [...new Map(found.map(r=>[r.url,r])).values()].slice(0,12);
}
export class EnterpriseSources {
 private enabled=true;
 private startup:Promise<void>;
 constructor(private root:string,private cli:CliRunner=runLark){this.startup=this.load();}
 private async load(){try{const v=JSON.parse(await readFile(path.join(this.root,'source-settings.json'),'utf8'));this.enabled=v.feishu_enabled!==false;}catch{/* First run defaults to user-requested enterprise search. */}}
 async setEnabled(enabled:boolean){await this.startup;await mkdir(this.root,{recursive:true});const file=path.join(this.root,'source-settings.json');await writeFile(file+'.tmp',JSON.stringify({feishu_enabled:enabled,douyin_project_url:DOUYIN_PROJECT}));await rename(file+'.tmp',file);this.enabled=enabled;}
 async larkStatus():Promise<SourceConnection>{
  await this.startup;
  const base={id:'feishu' as const,name:'飞书知识库',enabled:this.enabled};
  if(!this.enabled)return {...base,status:'disabled',message:'已暂停自动检索。'};
  try{const a=await this.cli(['auth','status','--json','--verify']);const u=a.identities?.user;
   return u?.available===true&&u?.verified===true?{...base,status:'ready',message:'按当前用户权限检索视频文件与文档附件。'}:{...base,status:'needs_auth',message:'用户登录已失效，请重新授权飞书 CLI。'};
  }catch(error){return {...base,status:error instanceof LarkError&&error.kind==='unavailable'?'unavailable':'error',message:(error as Error).message};}
 }
 async status():Promise<SourceConnection[]>{return [await this.larkStatus(),{id:'douyin',name:'抖音 AI 工作台',enabled:false,status:'pending_connection',url:DOUYIN_PROJECT,message:'已核对官方视频搜索能力；本地自动调用仍需平台 API 接入配置。网页授权不等于本地接口已接通。'}];}
 async discover(subject:string):Promise<{candidates:StockCandidate[];references?:SourceReference[];report:SearchSourceReport}>{
  const state=await this.larkStatus();
  if(state.status!=='ready')return {candidates:[],report:{provider:'Feishu',status:state.status==='disabled'?'skipped':state.status==='needs_auth'?'needs_auth':'error',found:0,message:state.message}};
  const query=[...subject.trim()].slice(0,30).join('');
  if(!query)return {candidates:[],report:{provider:'Feishu',status:'skipped',found:0,message:'需要明确的检索主题。'}};
  const candidates:StockCandidate[]=[],references:SourceReference[]=[],warnings:string[]=[];let inspected=0,hasMore=false,searches=0;
  try{
   // Search files separately: document-body matches used to crowd actual videos out of the first page.
   const rows:ReturnType<typeof larkResults>=[];
   for(const types of ['file','docx,wiki']){
    try{const result=await this.cli(['drive','+search','--query',query,'--doc-types',types,...(types==='file'?['--only-title']:[]),'--page-size','20','--as','user','--format','json']);
     if(result.ok!==true||result.identity!=='user')throw new LarkError('auth','飞书必须使用已授权的用户身份。');
     rows.push(...larkResults(result.data));hasMore ||= !!result.data?.has_more;searches++;
    }catch(error){if(error instanceof LarkError&&error.kind==='auth')throw error;warnings.push(types==='file'?'视频文件检索未完成':'文档检索未完成');}
   }
   if(!searches)throw new LarkError('failed','飞书检索未完成，请检查连接后重试。');
   const score=(title:string)=>(videoName(title)?100:0)+(title.toLowerCase().includes(query.toLowerCase())?20:0)+(/素材|案例|范例|广告/.test(title)?8:0)+(/视频|游戏/.test(title)?3:0);
   const visited=new Set<string>();let inspectLimit=8,expanded=false;
   const scan=async(batch:ReturnType<typeof larkResults>)=>{
   const unique=[...new Map(batch.map(r=>[r.resource!.url,r])).values()].sort((a,b)=>score(b.title)-score(a.title));
   for(const row of unique){
    let r=row.resource!;
    if(visited.has(r.url))continue;
    if(['docx','wiki'].includes(r.type)&&!videoName(row.title)&&inspected>=inspectLimit)continue;
    visited.add(r.url);
    if(r.type==='wiki'&&videoName(row.title)){
     try{const resolved=await this.cli(['drive','+inspect','--url',r.url,'--as','user','--format','json']);
      if(resolved.ok!==true||resolved.identity!=='user')throw Error('User identity required');
      const canonical=larkResource(resolved.data?.url||'');
      if(!canonical||canonical.type!=='file'||canonical.token!==resolved.data?.token)throw Error('Not a video file');r=canonical;
     }catch{warnings.push('部分知识库视频文件无法解析，可能需要节点读取权限');continue;}
    }
    if(r.type==='file'&&videoName(row.title))candidates.push({provider:'Feishu',usage:'enterprise_reference',title:row.title,description:'飞书云空间视频文件（尚未分析画面）',source_url:r.url,download_url:'',license_url:'',lark:{token:r.token,type:'file'}});
    if(['docx','wiki'].includes(r.type)&&inspected++<inspectLimit){
     try{const doc=await this.cli(['docs','+fetch','--doc',r.url,'--scope','keyword','--keyword',`${query.replace(/[|\\.*+?^$()[\]{}]/g,' ')}${row.title.toLowerCase().includes(query.toLowerCase())?'|mp4|mov|webm':''}`,'--context-after','1','--as','user','--format','json']);
      if(doc.ok!==true||doc.identity!=='user')throw new LarkError('auth','飞书文档读取需要用户身份。');
      const content=doc.data?.document?.content;if(typeof content!=='string')throw Error('文档格式无法识别');
      candidates.push(...documentVideos(content,r.url,row.title));
      references.push(...documentReferences(content,r.url,query));
     }catch{warnings.push('部分文档附件无法读取');}
    }
   }
   };
   await scan(rows);
   // A broad product query often ranks discussion docs above actual material/example docs.
   // One bounded refinement is enough; never crawl the whole enterprise knowledge base.
   if(!candidates.length&&!references.length){
    try{const materialQuery=[...query].slice(0,27).join('')+' 素材';
     const extra=await this.cli(['drive','+search','--query',materialQuery,'--doc-types','docx,wiki','--page-size','20','--as','user','--format','json']);
     if(extra.ok!==true||extra.identity!=='user')throw new LarkError('auth','飞书文档读取需要用户身份。');
     expanded=true;hasMore ||= !!extra.data?.has_more;inspectLimit=16;await scan(larkResults(extra.data));
    }catch(error){if(error instanceof LarkError&&error.kind==='auth')throw error;warnings.push('补充素材检索未完成');}
   }
   const result={candidates:[...new Map(candidates.map(c=>[c.lark!.token,c])).values()].slice(0,5),references:[...new Map(references.map(r=>[r.url,r])).values()].slice(0,12),report:{provider:'Feishu',status:'ok' as const,found:new Set(candidates.map(c=>c.lark!.token)).size,references_found:new Set(references.map(r=>r.url)).size,message:[hasMore?'已检查文件与文档各首批 20 条结果，可细化主题继续检索':'',expanded?'已补查主题相关的素材文档':'',...new Set(warnings)].filter(Boolean).join('；')||undefined}};
   // Keep a small, inspectable last-sync index. No full document text, account data or temporary media URLs.
   try{await mkdir(this.root,{recursive:true});const target=path.join(this.root,'enterprise-index.json');await writeFile(target+'.tmp',JSON.stringify({query,checked_at:new Date().toISOString(),...result},null,2));await rename(target+'.tmp',target);}catch{result.report.message=[result.report.message,'本次索引未能保存'].filter(Boolean).join('；');}
   return result;
  }catch(error){return {candidates:[],report:{provider:'Feishu',status:error instanceof LarkError&&error.kind==='auth'?'needs_auth':'error',found:0,message:(error as Error).message}};}
 }
 async download(candidate:StockCandidate,destination:string){
  const ref=candidate.lark;if(candidate.provider!=='Feishu'||candidate.usage!=='enterprise_reference'||!ref||!validToken(ref.token))throw Error('飞书素材引用无效');
  const source=larkResource(ref.parent_url||candidate.source_url);
  if(!source||(ref.type==='file'&&(source.type!=='file'||source.token!==ref.token))||(ref.type==='media'&&!['docx','wiki'].includes(source.type)))throw Error('飞书素材来源无效');
  // Re-check current permissions before download. Do not reuse expired URLs or read another identity's resources.
  if((await this.larkStatus()).status!=='ready')throw Error('飞书用户连接不可用，请重新授权后导入。');
  const args=ref.type==='file'?['drive','+download','--file-token',ref.token]:['docs','+media-download','--token',ref.token];
  const result=await this.cli([...args,'--output',path.basename(destination),'--as','user','--format','json'],{cwd:path.dirname(destination),output:destination,timeout:120000});
  if(result.ok!==true||result.identity!=='user')throw Error('飞书视频下载未完成');
  const s=await stat(destination);if(!s.isFile()||s.size<=0||s.size>160*1024*1024)throw Error('飞书视频文件为空或超过 160 MB');
 }
}
