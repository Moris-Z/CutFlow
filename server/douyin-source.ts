import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,chmod} from 'node:fs/promises';
import type {SourceConnection,SourceReference,SearchSourceReport} from '../shared/types.js';
import {DOUYIN_PROJECT} from './enterprise-sources.js';

const BASE='https://douyin-ai.bytedance.net/api/ai_platform/gateway_ingress/';
const AGENT='assist_7689858916037151526',TENANT='douyin_experience';
type Config={api_key:string;user_id:string;verified_at?:string};
type Transport=typeof fetch;
/** Only documented gateway endpoints; never browser cookies, inferred internal routes or caller-supplied hosts. */
export class DouyinSource {
 private config?:Config;
 private startup:Promise<void>;
 private failure='';
 constructor(private root:string,private request:Transport=fetch){this.startup=this.load();}
 private get file(){return path.join(this.root,'douyin-credentials.json');}
 private async load(){try{const c=JSON.parse(await readFile(this.file,'utf8'));if(typeof c.api_key==='string'&&typeof c.user_id==='string')this.config=c;}catch{}}
 private async save(){await mkdir(this.root,{recursive:true});await writeFile(this.file+'.tmp',JSON.stringify(this.config),{mode:0o600});await chmod(this.file+'.tmp',0o600);await rename(this.file+'.tmp',this.file);}
 async configure(key:string){await this.startup;if(!/^[\x21-\x7e]{12,512}$/.test(key)||key.includes('*'))throw Error('请填写完整的 API Key');this.config={api_key:key,user_id:`cutflow_${randomUUID()}`};await this.save();return this.check();}
 private async invoke(endpoint:'create_conversation_outer'|'chat_outer',body:Record<string,unknown>){
  await this.startup;if(!this.config)throw Error('请先配置工作台 API Key');
  const response=await this.request(BASE+endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','api-key':this.config.api_key},body:JSON.stringify({agent_id:AGENT,tenant_id:TENANT,user_id:this.config.user_id,...body}),signal:AbortSignal.timeout(endpoint==='chat_outer'?120000:20000)});
  if(!response.ok)throw Error(`工作台接口返回 HTTP ${response.status}，请检查 API 发布状态与访问权限`);
  const reader=response.body?.getReader();if(!reader)throw Error('工作台返回空响应');let raw='',size=0;const decoder=new TextDecoder();
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2_000_000){await reader.cancel();throw Error('工作台响应过大，请缩小检索范围');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
  let result:any;try{result=JSON.parse(raw);}catch{throw Error('工作台未返回有效接口数据，请检查网络和 API 访问权限');}
  const data=result.data??result;
  if((result.code!==undefined&&result.code!==0)||(data.code!==undefined&&data.code!==0)||(data.BaseResp?.status_code??0)!==0)throw Error('工作台拒绝调用，请检查 API 凭证与发布配置');
  return data;
 }
 async check(){try{const data=await this.invoke('create_conversation_outer',{});if(typeof data.conversation_id!=='string'||!data.conversation_id)throw Error('工作台未返回有效会话，暂不能调用');this.config!.verified_at=new Date().toISOString();this.failure='';await this.save();}catch(e){this.failure=e instanceof Error&&/工作台|API/.test(e.message)?e.message:'工作台接口连接失败，请检查网络后重试';if(this.config){delete this.config.verified_at;await this.save();}}return this.status();}
 async status():Promise<SourceConnection>{await this.startup;return {id:'douyin',name:'抖音 AI 工作台',enabled:!!this.config,status:this.failure?'error':this.config?.verified_at?'ready':'pending_connection',url:DOUYIN_PROJECT,message:this.failure||(this.config?.verified_at?'API 已验证；按主题查询视频参考，文件可用性另行检查。':'项目 API 已启用，配置本机凭证后可验证连接。')};}
 async discover(subject:string):Promise<{references:SourceReference[];report:SearchSourceReport}>{
  await this.startup;if(!this.config)return {references:[],report:{provider:'Douyin',status:'skipped',found:0,message:'尚未配置工作台 API 凭证'}};
  try{const query=subject.trim().slice(0,120);const data=await this.invoke('chat_outer',{user_id:`cutflow_search_${randomUUID()}`,query:`这是一次素材检索请求，主题：${JSON.stringify(query)}。只调用已配置的官方抖音视频搜索工具查找相关视频，最多5条。不要生成视频或修改配置。不要编造结果。仅返回JSON：{"videos":[{"title":"搜索返回的原始标题","url":"搜索返回的抖音视频页面链接"}],"message":"检索情况"}。无法调用工具则videos为空并说明。`,conversation_id:''});
   const output=douyinOutput(data);if(!Array.isArray(output?.videos))throw Error('工作台返回的检索结果格式无法识别，请重试');
   const references=douyinReferences(data);
   if(output.videos.length&&!references.length)throw Error('工作台返回了视频结果，但链接格式尚不支持，需更新解析器');
   const note=typeof output.message==='string'?output.message.replaceAll(this.config.api_key,'[隐藏]').slice(0,180):'';
   return {references,report:{provider:'Douyin',status:'ok',found:0,references_found:references.length,message:references.length?'工作台返回的视频参考；尚未取得可导入文件。':note||'工作台本轮未返回视频链接，可细化主题重试。'}};
  }catch(e){return {references:[],report:{provider:'Douyin',status:'error',found:0,message:e instanceof Error&&/工作台|API/.test(e.message)?e.message:'工作台素材检索未完成，请稍后重试'}};}
 }
}
/** Agent output is untrusted reference metadata, never an automatically downloadable file or visual proof. */
function douyinOutput(data:any):any{
 let output:any=data.result;
 try{if(typeof output==='string')output=JSON.parse(output);output=output?.output??output;if(typeof output==='string')output=JSON.parse(output.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g,''));return output;}catch{return;}
}
export function douyinReferences(data:any):SourceReference[]{
 const output=douyinOutput(data);
 if(!Array.isArray(output?.videos))return [];
 const refs:SourceReference[]=[];
 for(const item of output.videos.slice(0,20)){if(typeof item.title!=='string'||!item.title.trim()||typeof item.url!=='string')continue;try{const u=new URL(item.url);if(u.protocol!=='https:'||u.username||u.password||u.port)continue;
  const match=['www.douyin.com','douyin.com'].includes(u.hostname)?u.pathname.match(/^\/video\/(\d{16,22})\/?$/):['www.iesdouyin.com','iesdouyin.com'].includes(u.hostname)?u.pathname.match(/^\/share\/video\/(\d{16,22})\/?$/):null;
  if(!match)continue;refs.push({provider:'Douyin',title:item.title.slice(0,240),url:`https://www.douyin.com/video/${match[1]}`});}catch{}}
 return [...new Map(refs.map(r=>[r.url,r])).values()].slice(0,5);
}
