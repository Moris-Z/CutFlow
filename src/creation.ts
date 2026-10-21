import {z} from 'zod';
import {BriefSchema,type Brief} from '../shared/types';
import {recipes,recipeName,type RecipeId} from '../shared/recipes';
import {getSkill,resolveSkillId,type SkillId} from '../shared/skills';

export const initialBrief:Brief={request:'',recipe:'auto',scenario:'montage',product:'',audience:'',platform:'抖音',duration_ms:30000,aspect_ratio:'9:16',resolution:'1080p',fps:30,cta:'',allow_text_overlays:false,style:'节奏紧凑，突出核心信息',subtitles:false};
export interface CreationDraft {brief:Brief;name:string;assetIds:string[];skillPrompt:string;searchJobId?:string}
export const emptyDraft=():CreationDraft=>({brief:{...initialBrief},name:'',assetIds:[],skillPrompt:''});
export function skillPrompt(id:RecipeId):string {
  const recipe=recipes.find(r=>r.id===id);
  return recipe?`请用「${recipe.name}」剪辑视频。\n镜头安排：${recipe.stages.map(s=>s.name).join(' → ')}。\n${recipe.rhythm}。完整保留关键动作，只使用素材中有依据的信息。`:'请根据素材和我的需求，选择合适的剪辑方式，剪成一支广告视频。突出核心信息，完整保留关键动作。';
}
// The user's words remain untouched. Instructions are resolved on the server by skill ID.
export function applySkill(draft:CreationDraft,id:SkillId):CreationDraft {
  const own=draft.skillPrompt&&draft.brief.request.includes(draft.skillPrompt)?draft.brief.request.replace(draft.skillPrompt,'').trim():draft.brief.request;
  const {skill_options:oldOptions,...base}=draft.brief;
  return {...draft,skillPrompt:'',brief:{...base,...(draft.brief.skill_id===id&&oldOptions?{skill_options:oldOptions}:{}),skill_id:id,...(id==='kinetic_captions'?{subtitles:true}:{}),recipe:getSkill(id)?.recipe||'auto',...(getSkill(id)?.behavior==='portrait'?{aspect_ratio:'9:16' as const,platform:'TikTok'}:{}),request:own}};
}
export function restoreDraft(value:string|null):CreationDraft {
  try {
    const raw=JSON.parse(value||'null');
    const parsed=BriefSchema.extend({request:z.string().max(20000)}).safeParse(raw?.brief);
    if(!parsed.success)return emptyDraft();
    const oldPrompt=typeof raw.skillPrompt==='string'?raw.skillPrompt:'';
    if(oldPrompt&&parsed.data.request.includes(oldPrompt))parsed.data.request=parsed.data.request.replace(oldPrompt,'').trim();
    if(!parsed.data.skill_id&&oldPrompt)parsed.data.skill_id=resolveSkillId(parsed.data.recipe);
    return {...(typeof raw.searchJobId==='string'?{searchJobId:raw.searchJobId}:{}),brief:parsed.data,name:typeof raw.name==='string'?raw.name.slice(0,100):'',assetIds:Array.isArray(raw.assetIds)?[...new Set<string>(raw.assetIds.filter((id:unknown)=>typeof id==='string'))].slice(0,12):[],skillPrompt:''};
  }catch{return emptyDraft();}
}
export type PageView='create'|'skills'|'projects'|'workspace'|'assets'|'music'|'trace';
export interface PageRoute {view:PageView;projectId?:string;skillId?:SkillId}
export function parseRoute(hash:string):PageRoute {
  const [page,id]=hash.replace(/^#\/?/,'').split('/');
  if(page==='project'&&id)return {view:'workspace',projectId:id};
  if(page==='trace'&&id)return {view:'trace',projectId:id};
  if(page==='skills')return {view:'skills',skillId:resolveSkillId(id)};
  return {view:['create','projects','assets','music'].includes(page)?page as PageView:'create'};
}
export const routeHash=(route:PageRoute)=>route.view==='workspace'?`#project/${route.projectId}`:route.view==='trace'?`#trace/${route.projectId}`:route.view==='skills'&&route.skillId?`#skills/${route.skillId}`:`#${route.view}`;
export {recipeName};
