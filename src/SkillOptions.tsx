import type {SkillId} from '../shared/skills';
import type {Asset,Brief} from '../shared/types';
import {SelectControl} from './SelectControl';
export const hasSkillOptions=(id?:SkillId)=>['viral_remake','same_rhythm','comment_reply','video_translate','overseas_recut','tvc_to_ugc','benefit_variants','audience_variants'].includes(id||'');
export function SkillOptions({brief,assets,onChange}:{brief:Brief;assets:Asset[];onChange:(brief:Brief)=>void}){
 const id=brief.skill_id,options=brief.skill_options||{};
 const set=(value:Partial<NonNullable<Brief['skill_options']>>)=>onChange({...brief,skill_options:{...options,...value}});
 return <div className="skill-options-fields">
  {(id==='viral_remake'||id==='same_rhythm')&&<SelectControl label="参考视频" value={options.reference_asset_id||''} options={[{value:'',label:'从素材库选择参考片'},...assets.map(a=>({value:a.id,label:a.name}))]} onChange={reference_asset_id=>set({reference_asset_id:reference_asset_id||undefined})}/>}
  {id==='comment_reply'&&<label>要回答的评论<textarea aria-label="要回答的评论" rows={3} value={options.comment||''} maxLength={500} placeholder="例如：这个咖啡机清洗方便吗？" onChange={e=>set({comment:e.target.value})}/></label>}
  {['video_translate','overseas_recut','tvc_to_ugc'].includes(id||'')&&<SelectControl label="配音语言" value={options.target_language||''} onChange={v=>set({target_language:v as NonNullable<Brief['skill_options']>['target_language']})} options={[{value:'',label:'请选择语言'},{value:'zh',label:'中文'},{value:'en',label:'英语'},{value:'ja',label:'日语'},{value:'es',label:'西班牙语'},{value:'fr',label:'法语'}]}/>}
  {id==='overseas_recut'&&<label>目标市场<input aria-label="目标市场" placeholder="例如：美国、日本" maxLength={100} value={options.market||''} onChange={e=>set({market:e.target.value})}/></label>}
  {(id==='benefit_variants'||id==='audience_variants')&&<label>{id==='benefit_variants'?'每个版本的卖点':'每个版本的人群'}<textarea aria-label="版本主题" rows={4} placeholder="每行一个，填写 2–10 个" maxLength={1200} value={options.variant_topics??options.variants?.join('\n')??''} onChange={e=>set({variant_topics:e.target.value,variants:undefined})}/></label>}
  {id==='hook_variants'&&<p>生成 3 个开场版本，主体保持一致。请准备至少 3 个开场镜头和 1 个主体镜头。</p>}
  {id==='ten_versions'&&<p>用不同的开场和镜头组合生成 10 个版本，每个版本可单独确认和预览。</p>}
  {id==='multi_size'&&<p>同一剪辑生成竖屏、横屏和方形 3 个版本，分别预览和导出。</p>}
 </div>;
}
