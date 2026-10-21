import {randomUUID} from 'node:crypto';
import type {Task} from '../shared/types.js';
import {Store,addEvent} from './store.js';
import {SourceSearch} from './source-search.js';
import {searchIntent} from './search-intent.js';
import {assert} from './errors.js';

export const preparationBusy=(task:Task)=>!!task.preparation&&['queued','searching','planning'].includes(task.preparation.status);
export function reply(task:Task,text:string,role:'assistant'|'user'='assistant'){
 task.preparation!.messages.push({id:randomUUID(),role,text});
 if(role==='assistant')task.preparation!.message=text;
}
/** Preparation belongs to a persisted project, not to a browser request. */
export class ProjectPreparation {
 private tail:Promise<void>=Promise.resolve();
 constructor(private store:Store,private search:SourceSearch,private plan:(id:string)=>Promise<Task>){}
 idle(task:Task){assert(!preparationBusy(task),'PREPARATION_BUSY','正在整理这个项目，请稍等片刻。',409);}
 enqueue(task:Task){
  this.idle(task);
  assert(task.state==='DRAFT_BRIEF'&&!task.edl,'BRIEF_ALREADY_PLANNED','方案已生成，请使用视频修改入口。',409);
  task.preparation={status:'queued',message:'',messages:task.preparation?.messages||[]};
  if(!task.preparation.messages.length){
   reply(task,task.brief.request,'user');
   const intent=searchIntent(task.brief.request,task.brief.product);
   reply(task,task.asset_ids.length?'收到，我会结合你的素材和要求整理剪辑方案。':intent.subject?`收到，将围绕「${intent.subject}」制作${intent.kind==='game'?'游戏广告':'视频'}，按你的要求查找对应素材。`:'收到，我会先理解你的想法并查找素材，需要补充的信息在这里确认。');
  }else task.preparation.message=task.asset_ids.length?'正在根据素材整理方案…':'正在根据补充需求查找素材…';
  this.store.save(task);
  this.tail=this.tail.then(()=>this.execute(task.id)).catch(error=>{
   const current=this.store.task(task.id);if(!current?.preparation)return;
   current.preparation.status='needs_input';reply(current,(error as Error).message||'准备中断，可以在这里重试。');addEvent(current,'preparation.failed',current.preparation.message);this.store.save(current);
  });
  return task;
 }
 async settled(){await this.tail;}
 private async execute(id:string){
  let task=this.store.task(id);if(!task?.preparation||task.edl)return;
  if(!task.asset_ids.length){
   task.preparation.status='searching';this.store.save(task);
   const job=await this.search.startQueued(task.brief.request,task.brief.product);
   task=this.store.task(id);if(!task?.preparation||task.edl)return;
   task.preparation.search_job_id=job.id;this.store.save(task);
   const found=await this.search.wait(job.id);
   task=this.store.task(id);if(!task?.preparation||task.edl)return;
   task.preparation.sources=found.sources;
   task.preparation.references=found.references;
   if(found.status!=='ready'){
    task.preparation.status='needs_input';reply(task,found.message);addEvent(task,'source_search.needs_input',found.message,{job_id:job.id,queries:found.query});this.store.save(task);return;
   }
   task.asset_ids=found.assets.filter(a=>{const stored=this.store.asset(a.id);return stored&&!stored.deleted_at;}).map(a=>a.id);
   if(!task.asset_ids.length){task.preparation.status='needs_input';reply(task,'找到的素材已从素材库删除，可以重新查找或上传视频。');this.store.save(task);return;}
   reply(task,`已从 ${[...new Set(found.assets.map(a=>a.source?.provider).filter(Boolean))].join('、')||'网络'} 导入 ${task.asset_ids.length} 份素材，接下来整理剪辑方案。`);
  }
  task.preparation.status='planning';task.preparation.message='正在结合素材与要求整理剪辑方案…';this.store.save(task);
  await this.plan(id);
  task=this.store.task(id);if(!task?.preparation)return;
  task.preparation.status='ready';reply(task,'剪辑方案已就绪。');this.store.save(task);
 }
}
