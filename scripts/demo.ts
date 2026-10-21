export {};
/** Synthetic demo driver: prepares a full preview and stops at local revision review. */
const base=process.env.CUTFLOW_URL||'http://127.0.0.1:4318';
async function api(route:string,body?:unknown){const res=await fetch(`${base}/api${route}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw Error(JSON.stringify(data));return data;}
async function wait(id:string){for(let i=0;i<600;i++){const task=await api(`/tasks/${id}`);if(['WAITING_USER_REVIEW','DELIVERED','FAILED','CANCELLED'].includes(task.state)){if(task.state==='FAILED'||task.state==='CANCELLED')throw Error(JSON.stringify(task.error||task.state));return task;}await new Promise(r=>setTimeout(r,1000));}throw Error('Render timeout');}
let task=await api('/demo',{});console.log(`Demo task: ${task.id}`);
if(task.state==='WAITING_PLAN_APPROVAL'){
 console.log('文字剪辑方案已生成。请在工作台确认后生成首版视频预览。');
 console.log(JSON.stringify(task.plan,null,2));
}else{
 task=await wait(task.id);console.log(`Preview: QA=${task.qa.passed}, version=${task.edl.version}`);
 task=await api(`/tasks/${task.id}/revise`,{feedback:'第1镜头保留前2秒',base_version:task.edl.version});
 if(task.pending_patch.text_review?.required){console.log('文字修改方案已生成，请到工作台确认。');console.log(JSON.stringify(task.pending_patch.changes,null,2));}
 else for(let i=0;i<600;i++){
  task=await api(`/tasks/${task.id}`);const preview=task.pending_patch?.preview;
  if(preview?.status==='ready'){console.log('片段对比已就绪。请在工作台观看并确认，再应用到完整视频。');break;}
  if(preview?.status==='failed'||preview?.status==='cancelled')throw Error(preview.error||preview.status);
  if(i===599)throw Error('Local preview timeout');await new Promise(r=>setTimeout(r,1000));
 }
}
