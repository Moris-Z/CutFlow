import {SelectControl} from './SelectControl';
import type { Asset, Shot } from '../shared/types';
import { matchRecipe, recipes, recipeName, researchSources, roleNames, type AdRole, type RecipeId, type RecipeMatch } from '../shared/recipes';

export function RecipeMatchView({ match, compact = false }: { match: RecipeMatch; compact?: boolean }) {
  return <div className={`recipe-match ${match.status === 'needs_material' ? 'pending' : ''}`} aria-live="polite">
    <strong>{match.requested === 'auto' ? '自动匹配结果' : `已选 · ${recipeName(match.requested)}`}：{recipeName(match.resolved)}</strong>
    <p>{match.reason}</p>
    {match.missing.length > 0 && <p>待补充：{match.missing.join('、')}</p>}
    {!compact && <details><summary>查看匹配依据与候选</summary><ul>{match.evidence.map(e => <li key={`${e.asset_id}-${e.shot_id}`}><b>{e.roles.map(r => roleNames[r]).join(' / ') || '用途待确认'}</b> · {e.basis}</li>)}</ul><p>候选结构：{match.alternatives.map(r => `${recipeName(r.id)} ${r.matched_stages}/${r.total_stages} 环节${r.ready ? '可匹配' : '待补齐'}`).join('；')}</p><small>匹配依据为已保存的人工注释和确认用途；不是画面识别置信度或广告效果评分。</small></details>}
  </div>;
}

export function RecipePicker({ value, onChange, assets }: { value: RecipeId; onChange: (value: RecipeId) => void; assets: Asset[] }) {
  const match = matchRecipe(assets, value);
  const chosen = recipes.find(r => r.id === (value === 'auto' ? match.resolved : value));
  return <section className="recipe-picker simple-recipe">
    <SelectControl label="剪辑风格" value={value} onChange={id=>onChange(id as RecipeId)} options={[{value:'auto',label:'自动匹配（推荐）',description:'根据素材选择合适的镜头安排'},...recipes.map(recipe=>({value:recipe.id,label:recipe.name,description:recipe.description}))]}/>
    <p className="field-help">{value==='auto' ? '根据素材内容，选择合适的镜头顺序和节奏。' : chosen?.description}</p>
    <details className="recipe-explainer"><summary>查看风格说明与素材建议</summary>{chosen && <div className="recipe-spec"><p><b>适用：</b>{chosen.industries}</p><p><b>需要：</b>{chosen.needs}</p><p><b>节奏：</b>{chosen.rhythm}</p><details><summary>参考来源</summary>{chosen.sources.map(id => <a key={id} href={researchSources[id].url} target="_blank" rel="noreferrer">{researchSources[id].name} ↗</a>)}</details></div>}{assets.length > 0 && <RecipeMatchView match={match}/>}</details>
  </section>;

}

export function AdRoleEditor({ shot, onChange }: { shot: Shot; onChange: (patch: Partial<Shot>) => void }) {
  return <fieldset className="ad-role-editor"><legend>这段素材在广告中的用途（可选）</legend><p className="field-help">观看素材后勾选。真人评价需原声和逐字稿；优惠与卖点须在该素材中有真实依据。</p><div className="ad-role-options">{Object.entries(roleNames).map(([role, label]) => <label key={role}><input type="checkbox" checked={shot.ad_roles?.includes(role as AdRole) || false} onChange={e => onChange({ ad_roles: e.target.checked ? [...(shot.ad_roles || []), role as AdRole] : shot.ad_roles?.filter(r => r !== role) })} />{label}</label>)}</div><button type="button" className="text-button small" onClick={() => onChange({ ad_roles: undefined })}>恢复根据画面注释推断</button>{shot.ad_roles?.some(r => r === 'before' || r === 'after') && <label>对比组名称<input value={shot.comparison_group || ''} maxLength={100} onChange={e => onChange({ comparison_group: e.target.value })} placeholder="同一对象的前后素材填写相同名称" /></label>}</fieldset>;
}
