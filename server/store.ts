import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Asset, Task, TraceEvent, MusicTrack, TrashKind, TrashItem } from '../shared/types.js';
import { randomUUID } from 'node:crypto';
export class Store {
  private db:DatabaseSync;
  constructor(readonly root:string){
    mkdirSync(root,{recursive:true});
    this.db=new DatabaseSync(path.join(root,'cutflow.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS music (id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);');
  }
  musicTracks(includeDeleted=false):MusicTrack[]{return this.db.prepare('SELECT value FROM music ORDER BY rowid').all().map(r=>JSON.parse(r.value as string)).filter(t=>includeDeleted||!t.deleted_at);}
  musicTrack(id:string):MusicTrack|undefined{const row=this.db.prepare('SELECT value FROM music WHERE id=?').get(id);return row?JSON.parse(row.value as string):undefined;}
  saveMusic(track:MusicTrack){this.db.prepare('INSERT INTO music VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(track.id,JSON.stringify(track));return track;}
  defaultBgmId():string{return this.db.prepare("SELECT value FROM preferences WHERE key='default_bgm_id'").get()?.value as string||'carefree';}
  setDefaultBgmId(id:string){this.db.prepare("INSERT INTO preferences VALUES('default_bgm_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(id);}
  confirmTextPlan():boolean{const row=this.db.prepare("SELECT value FROM preferences WHERE key='confirm_text_plan'").get();return row?JSON.parse(row.value as string):true;}
  setConfirmTextPlan(value:boolean){this.db.prepare("INSERT INTO preferences VALUES('confirm_text_plan',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value));}
  saveAsset(asset:Asset){this.db.prepare('INSERT INTO assets VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(asset.id,JSON.stringify(asset));return asset;}
  asset(id:string):Asset|undefined{const row=this.db.prepare('SELECT value FROM assets WHERE id=?').get(id);return row?JSON.parse(row.value as string):undefined;}
  assets(includeDeleted=false):Asset[]{return this.db.prepare('SELECT value FROM assets ORDER BY rowid DESC').all().map(r=>JSON.parse(r.value as string)).filter(a=>includeDeleted||!a.deleted_at);}
  save(task:Task){task.updated_at=new Date().toISOString();this.db.prepare('INSERT INTO tasks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(task.id,JSON.stringify(task),task.updated_at);return task;}
  saveTasks(tasks:Task[]){this.db.exec('BEGIN IMMEDIATE');try{for(const task of tasks)this.save(task);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}}
  task(id:string,includeDeleted=false):Task|undefined{const row=this.db.prepare('SELECT value FROM tasks WHERE id=?').get(id);const task=row?JSON.parse(row.value as string):undefined;return task && (includeDeleted||!task.deleted_at)?task:undefined;}
  tasks(includeDeleted=false):Task[]{return this.db.prepare('SELECT value FROM tasks ORDER BY updated_at DESC').all().map(r=>JSON.parse(r.value as string)).filter(t=>includeDeleted||!t.deleted_at);}
  trash():TrashItem[]{return [
    ...this.tasks(true).filter(t=>t.deleted_at).map(t=>({kind:'tasks' as const,id:t.id,name:t.name,deleted_at:t.deleted_at!})),
    ...this.assets(true).filter(a=>a.deleted_at).map(a=>({kind:'assets' as const,id:a.id,name:a.name,deleted_at:a.deleted_at!})),
    ...this.musicTracks(true).filter(m=>m.deleted_at).map(m=>({kind:'music' as const,id:m.id,name:m.title,deleted_at:m.deleted_at!})),
  ].sort((a,b)=>b.deleted_at.localeCompare(a.deleted_at));}
  // Keep source files and immutable project references available after library deletion.
  setDeleted(kind:TrashKind,id:string,deleted:boolean){
    const table={tasks:'tasks',assets:'assets',music:'music'}[kind];
    const row=this.db.prepare(`SELECT value FROM ${table} WHERE id=?`).get(id);
    if(!row)return false;
    const value=JSON.parse(row.value as string);
    if(deleted)value.deleted_at??=new Date().toISOString();else delete value.deleted_at;
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare(`UPDATE ${table} SET value=? WHERE id=?`).run(JSON.stringify(value),id);
      if(kind==='music'&&deleted&&this.defaultBgmId()===id)this.setDefaultBgmId('carefree');
      this.db.exec('COMMIT');return true;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  recover(){for(const task of this.tasks()){
    if(task.preparation&&['queued','searching','planning'].includes(task.preparation.status)){task.preparation.status=task.edl?'ready':'needs_input';task.preparation.message=task.edl?'方案已恢复。':'服务重启中断了准备工作，需求已保存，可以继续查找或上传素材。';task.preparation.messages.push({id:randomUUID(),role:'assistant',text:task.preparation.message});addEvent(task,'preparation.interrupted',task.preparation.message);this.save(task);}
    if(task.pending_patch?.preview&&['queued','rendering'].includes(task.pending_patch.preview.status)){task.pending_patch.preview.status='failed';task.pending_patch.preview.error='服务退出中断了片段预览，可重新生成；完整版本保持不变';addEvent(task,'patch.preview.interrupted',task.pending_patch.preview.error);this.save(task);}
    if(['COMPILING','RENDERING_PREVIEW','QUALITY_CHECKING','RENDERING_FINAL'].includes(task.state)){const stage=task.state;task.state='FAILED';task.error={code:'PROCESS_INTERRUPTED',message:'服务上次退出时任务尚未完成。工程已恢复，可重试当前渲染。',retryable:true,stage};addEvent(task,'harness.recovered','已从持久检查点恢复；等待重试');this.save(task);}
  }}
  close(){this.db.close();}
}
export function addEvent(task:Task,type:string,message:string,data?:Record<string,unknown>){const event:TraceEvent={id:randomUUID(),at:new Date().toISOString(),stage:task.state,type,message,...(data?{data}:{})};task.events.push(event);return event;}
