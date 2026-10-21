import {readFile,writeFile,mkdir,rm,readdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {assert} from './errors.js';
import {searchIntent} from './search-intent.js';
import {discoverSteam,downloadSteam,safeSteamURL} from './steam-source.js';
import {callModel,modelAvailable} from './model.js';
import {ingestVideo} from './media.js';
import {publicAsset} from './harness.js';
import type {Store} from './store.js';
import type {Asset,SourceSearchJob,SearchSourceReport,SourceReference} from '../shared/types.js';

export interface StockCandidate {provider?:'Mixkit'|'Steam'|'Feishu';usage?:'stock_license'|'publisher_reference'|'enterprise_reference';lark?:{token:string;type:'file'|'media';parent_url?:string};title:string;description:string;source_url:string;download_url:string;license_url:string}
const topics:[RegExp,string][]=[[/咖啡|coffee|cappuccino|espresso/i,'coffee'],[/披萨|pizza/i,'pizza'],[/护肤|美妆|美容|skincare|beauty/i,'beauty'],[/旅行|旅游|度假|travel|vacation/i,'travel'],[/跑步|运动|健身|running|fitness|sport/i,'fitness'],[/海滩|沙滩|beach/i,'beach'],[/宠物|狗|猫|pet|dog|cat\b/i,'pets'],[/汽车|驾车|car\b|driving/i,'car'],[/美食|餐饮|食品|food/i,'food'],[/烘焙|面包|蛋糕|bakery|cake|bread/i,'bakery'],[/茶饮|茶叶|tea\b/i,'tea'],[/手机|phone/i,'phone'],[/电脑|计算机|laptop|computer/i,'computer'],[/家居|家具|furniture|home/i,'home'],[/清洁|打扫|cleaning/i,'cleaning'],[/服装|穿搭|时尚|fashion|clothes/i,'fashion'],[/珠宝|首饰|jewelry/i,'jewelry'],[/酒店|民宿|hotel/i,'hotel'],[/办公|企业|office|business/i,'business'],[/自然|森林|nature|forest/i,'nature'],[/花卉|鲜花|flower/i,'flowers'],[/水果|fruit/i,'fruit'],[/饮料|果汁|drink|juice/i,'drink'],[/鞋|shoes/i,'shoes']];
export function basicSearchTerms(request:string,product=''):string[]{
 const intent=searchIntent(request,product);
 if(intent.aliases.length)return intent.aliases;
 const text=intent.subject||product.trim()||request;
 const matches=topics.filter(([pattern])=>pattern.test(text)).map(([,term])=>term);
 if(matches.length)return [...new Set(matches)].slice(0,3);
 // English subjects can be searched directly; boilerplate skill prompts do not become queries.
 const english=text.replace(/\b(agent|cutflow|mp4|mov|webm|bgm|video|advertisement|ad|create|make|please)\b/gi,' ').match(/\b[a-z][a-z -]{1,70}\b/gi)?.map(s=>s.trim().replace(/\s+/g,'-')).filter(Boolean)||[];
 return english.slice(0,2).filter(s=>/^[a-z]+(?:-[a-z]+)*$/i.test(s));
}
export function safeStockURL(value:string,kind:'page'|'media'):boolean{
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&(kind==='media'?u.hostname==='assets.mixkit.co'&&u.pathname.endsWith('.mp4'):u.hostname==='mixkit.co'&&/^\/free-stock-video\/[a-z0-9-]+-\d+\/$/.test(u.pathname));}catch{return false;}
}
export function parseStockPage(html:string):StockCandidate[]{
 const result:StockCandidate[]=[];
 for(const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  let document:unknown;try{document=JSON.parse(match[1]);}catch{continue;}
  const walk=(node:any)=>{if(!node||typeof node!=='object')return;if(node['@type']==='VideoObject'&&node.isAccessibleForFree===true&&node.license==='https://mixkit.co/license/#videoFree'){
   const source=String(node['@id']||'').split('#')[0],download=String(node.contentUrl||'');
   if(safeStockURL(source,'page')&&safeStockURL(download,'media')&&typeof node.name==='string')result.push({title:node.name.slice(0,180),description:String(node.description||'').slice(0,1000),source_url:source,download_url:download,license_url:node.license});
  }for(const value of Object.values(node))if(typeof value==='object'){if(Array.isArray(value))value.forEach(walk);else walk(value);}};walk(document);
 }
 return [...new Map(result.map(item=>[item.source_url,item])).values()];
}
export async function boundedFetch(url:string,max:number,timeout:number,request:typeof fetch=fetch):Promise<Buffer>{
 const allowed=(value:string)=>{try{const u=new URL(value);return safeStockURL(value,'media')||(u.protocol==='https:'&&u.hostname==='mixkit.co'&&!u.username&&!u.password&&!u.port&&!u.search&&/^\/free-stock-video\/(?:discover\/)?[\p{L}\p{N}-]+\/$/u.test(decodeURIComponent(u.pathname)));}catch{return false;}};
 const signal=AbortSignal.timeout(timeout);let response:Response|undefined;
 // Mixkit redirects common search phrases to curated category pages. Check each hop before sending it.
 for(let hop=0;hop<4;hop++){
  if(!allowed(url))throw new Error('素材链接不在支持的来源内');
  response=await request(url,{redirect:'manual',signal,headers:{'User-Agent':'CutFlow/0.1 (stock footage discovery)'}});
  if(![301,302,303,307,308].includes(response.status))break;
  const location=response.headers.get('location');await response.body?.cancel();
  if(!location||hop===3)throw new Error('素材站重定向异常');url=new URL(location,url).href;
 }
 if(!response)throw new Error('素材站暂时无法访问');
 if(!response.ok||!response.body)throw new Error(`素材站暂时无法访问（${response.status}）`);
 if(Number(response.headers.get('content-length'))>max){await response.body.cancel();throw new Error('素材文件过大，已跳过');}
 const chunks:Uint8Array[]=[];let size=0;const reader=response.body.getReader();
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new Error('素材文件过大，已跳过');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(chunks);
}
export async function discoverStock(terms:string[]):Promise<StockCandidate[]>{
 const found:StockCandidate[]=[];
 for(const term of terms){assert(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(term),'SEARCH_QUERY_INVALID','请使用明确的产品或场景名称');
  const html=(await boundedFetch(`https://mixkit.co/free-stock-video/discover/${encodeURIComponent(term.toLowerCase())}/`,3_000_000,25000)).toString('utf8');
  found.push(...parseStockPage(html));
 }
 return [...new Map(found.map(item=>[item.source_url,item])).values()];
}
export interface SearchDependencies {discoverDouyin?:(subject:string)=>Promise<{references:SourceReference[];report:SearchSourceReport}>;discoverEnterprise?:(subject:string)=>Promise<{candidates:StockCandidate[];references?:SourceReference[];report:SearchSourceReport}>;downloadEnterprise?:(candidate:StockCandidate,destination:string)=>Promise<void>;discoverGame?:(terms:string[])=>Promise<StockCandidate[]>;downloadGame?:(url:string,destination:string)=>Promise<void>;discover?:(terms:string[])=>Promise<StockCandidate[]>;download?:(url:string)=>Promise<Buffer>;ingest?:typeof ingestVideo}
export class SourceSearch {
 private jobs=new Map<string,SourceSearchJob>();private active=false;private running?:Promise<void>;private completions=new Map<string,Promise<void>>();private startup:Promise<void>;
 constructor(private store:Store,private root:string,private dependencies:SearchDependencies={}){this.startup=this.recover();}
 private async recover(){await mkdir(this.root,{recursive:true});for(const name of await readdir(this.root)){if(!name.endsWith('.json'))continue;try{const job=JSON.parse(await readFile(path.join(this.root,name),'utf8')) as SourceSearchJob;if(job.status==='searching'){job.status='failed';job.message='素材查找被服务重启中断，请重新查找。';await this.save(job);}this.jobs.set(job.id,job);}catch{/* Ignore incomplete job records. */}}}
 private async save(job:SourceSearchJob){this.jobs.set(job.id,job);const file=path.join(this.root,`${job.id}.json`);await writeFile(`${file}.tmp`,JSON.stringify(job));await rename(`${file}.tmp`,file);}
 async get(id:string){await this.startup;const job=this.jobs.get(id);assert(job,'SEARCH_NOT_FOUND','这次素材查找已失效，请重新查找',404);return job;}
 async start(request:string,product=''){
  await this.startup;assert(!this.active,'SEARCH_BUSY','正在查找素材，请等待当前查找完成',409);
  const job:SourceSearchJob={id:randomUUID(),status:'searching',message:'正在理解需求并搜索网络素材…',query:[],assets:[],warnings:[],created_at:new Date().toISOString()};this.active=true;
  try{await this.save(job);}catch(error){this.active=false;this.jobs.delete(job.id);throw error;}
  const execution=this.execute(job,request,product).catch(()=>{job.status='failed';job.message='无法保存素材查找进度，请检查本地磁盘后重试。';}).finally(()=>{this.active=false;this.completions.delete(job.id);});this.running=execution;this.completions.set(job.id,execution);return job;
 }
 async wait(id:string){await this.startup;await this.completions.get(id);return this.get(id);}
 async startQueued(request:string,product=''){
  await this.startup;
  while(this.active)await (this.running||new Promise<void>(resolve=>setTimeout(resolve,10)));
  return this.start(request,product);
 }
 private async execute(job:SourceSearchJob,request:string,product:string){
  const saved:Asset[]=[];
  try{
   const intent=searchIntent(request,product);job.subject=intent.subject;job.kind=intent.kind;
   let terms=basicSearchTerms(request,product);
   if(!terms.length&&intent.subject)terms=[intent.subject.replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'')].filter(Boolean);
   if(modelAvailable()&&!intent.aliases.length){
    try{
    const parsed=await callModel('提取用户要制作广告的真实产品或场景，输出最多 3 个英文素材检索短语（小写字母与连字符）。不要把技能名称、示例提示、否定条件当作主题。不要输出网址。没有明确主题时输出空列表。返回 {queries:string[]}。',{request,product},z.object({queries:z.array(z.string().regex(/^[a-z]+(?:-[a-z]+)*$/).max(70)).max(3)}));if(parsed.queries.length)terms=parsed.queries;
    }catch{job.warnings.push('需求解析服务暂不可用，继续按原始主题查找。');}
   }
   job.needs_details=!terms.length;
   assert(terms.length,'SEARCH_SUBJECT_REQUIRED',intent.kind==='game'?'想为哪款游戏制作广告？告诉我游戏名，我会继续查找素材。':'这支视频想宣传什么？告诉我产品、品牌或主题，也可以直接上传素材。');job.query=terms;job.message='正在查找可用于创作的网络素材…';await this.save(job);
   const provider=intent.kind==='game'?'Steam':'Mixkit';
   let candidates:StockCandidate[]=[];job.sources=[];
   if(this.dependencies.discoverEnterprise){
    job.message='正在检索企业素材…';await this.save(job);
    try{const enterprise=await this.dependencies.discoverEnterprise(intent.subject||product||terms[0].replace(/-/g,' '));candidates.push(...enterprise.candidates);job.references=enterprise.references||[];job.sources.push(enterprise.report);}
    catch{job.sources.push({provider:'Feishu',status:'error',found:0,message:'企业素材检索未完成，请检查连接。'});}
   }
   if(this.dependencies.discoverDouyin){
    job.message='正在检索抖音视频参考…';await this.save(job);
    try{const result=await this.dependencies.discoverDouyin(intent.subject||product||terms[0].replace(/-/g,' '));job.references=[...new Map([...(job.references||[]),...result.references].map(r=>[r.url,r])).values()];job.sources.push(result.report);}
    catch{job.sources.push({provider:'Douyin',status:'error',found:0,message:'抖音工作台检索未完成，请检查连接。'});}
   }
   {
    job.message=`正在检索 ${provider} 素材…`;await this.save(job);
    try{
     let external=await (intent.kind==='game'?(this.dependencies.discoverGame||discoverSteam):(this.dependencies.discover||discoverStock))(terms);
     if(intent.kind==='game'){
      const compact=(value:string)=>value.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
      const names=[intent.subject,...intent.aliases,...terms].filter(Boolean).map(compact);
      external=external.filter(c=>names.some(name=>compact(c.title+' '+c.description).includes(name)));
     }
     job.sources.push({provider,status:'ok',found:external.length});candidates.push(...external);
    }catch{job.sources.push({provider,status:'error',found:0,message:`${provider} 素材检索暂时失败，可以稍后重试。`});}
   }
   const searched=job.sources.filter(s=>s.status==='ok').map(s=>s.provider).join('、');
   const unavailable=job.sources.filter(s=>['error','needs_auth'].includes(s.status));
   for(const source of unavailable)job.warnings.push(source.message||`${source.provider} 暂不可用`);
   if(!candidates.length&&job.references?.length)throw new Error(`已找到 ${job.references.length} 个相关视频链接，可在下方查看；当前来源未提供可直接导入的文件。可以上传其中的视频文件，或补充素材描述继续查找。`);
   assert(candidates.length,'STOCK_NOT_FOUND',unavailable.length?`部分素材源尚未完成检索：${unavailable.map(s=>s.message).join('；')}。${searched?`${searched} 暂未找到匹配视频。`:''}需求已保留。`:intent.subject?`已检索 ${searched||provider}，暂未找到「${intent.subject}」可直接导入的视频。可以补充具体画面后重新搜索，也可以上传素材。`:`已检索 ${searched||provider}，暂未找到匹配的视频，可以补充具体画面后重新搜索。`);
   for(const candidate of candidates.slice(0,8)){
    if(saved.length>=5)break;
    const game=candidate.provider==='Steam',enterprise=candidate.provider==='Feishu';
    assert(enterprise?!!this.dependencies.downloadEnterprise&&candidate.usage==='enterprise_reference'&&!!candidate.lark:game?safeSteamURL(candidate.download_url,'media')&&safeSteamURL(candidate.source_url,'page')&&candidate.usage==='publisher_reference':safeStockURL(candidate.download_url,'media')&&safeStockURL(candidate.source_url,'page')&&candidate.license_url==='https://mixkit.co/license/#videoFree','STOCK_SOURCE_INVALID','素材来源不符合要求');
    const existing=this.store.assets(true).find(a=>a.source?.url===candidate.source_url);
    if(existing?.deleted_at){job.warnings.push('已跳过你此前删除的素材。');continue;}
    if(existing){if(!saved.some(a=>a.id===existing.id))saved.push(existing);continue;}
    job.message=`正在导入素材 ${saved.length+1}/5…`;await this.save(job);
    const temp=path.join(this.root,`${job.id}.mp4`);
    try{
     if(enterprise)await this.dependencies.downloadEnterprise!(candidate,temp);
     else if(game)await (this.dependencies.downloadGame||downloadSteam)(candidate.download_url,temp);
     else{const bytes=await (this.dependencies.download||((url)=>boundedFetch(url,80*1024*1024,45000)))(candidate.download_url);await writeFile(temp,bytes);}
     let asset=await (this.dependencies.ingest||ingestVideo)(temp,`${candidate.title.replace(/[\\/]/g,'-')}${/\.(mp4|mov|m4v|webm|mkv|avi|ts|mpeg|mpg)$/i.test(candidate.title)?'':'.mp4'}`,path.join(this.store.root,'media','assets'));
     const prior=this.store.asset(asset.id);if(prior?.deleted_at){job.warnings.push('已跳过你此前删除的素材。');continue;}
     if(prior)asset=prior;else{asset.source={provider:enterprise?'Feishu':game?'Steam':'Mixkit',usage:enterprise?'enterprise_reference':game?'publisher_reference':'stock_license',url:candidate.source_url,license_url:candidate.license_url,description:candidate.description,retrieved_at:new Date().toISOString()};asset.warnings.push(enterprise?'企业知识库素材；来源描述不是画面分析，请核对内容是否符合当前需求。':game?'游戏发行方商店公开视频；未声明可商用许可。画面内容与可使用范围需在审阅中确认。':'网络素材：素材站描述未经视觉核实，请在文字方案与视频预览中确认画面和品牌适用性。');this.store.saveAsset(asset);}if(!saved.some(a=>a.id===asset.id))saved.push(asset);
    }catch(error){job.warnings.push(`未能导入「${candidate.title}」：${(error as Error).message.slice(0,240)}`);}finally{await rm(temp,{force:true});}
   }
   assert(saved.length,'STOCK_DOWNLOAD_FAILED',`已从 ${searched||provider} 找到 ${candidates.length} 段相关视频，但导入没有完成。可以重新搜索重试，或上传文件。`);job.assets=saved.map(publicAsset);job.status='ready';job.message=`已从 ${[...new Set(saved.map(a=>a.source?.provider||provider))].join('、')} 导入 ${saved.length} 份素材，可以生成剪辑方案。`;
  }catch(error){job.status='failed';job.assets=saved.map(publicAsset);job.message=(error as Error).message||'查找失败，请重试。';}
  await this.save(job);
 }
}
