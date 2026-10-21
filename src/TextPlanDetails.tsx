import type {Asset,EDL,TextChange} from '../shared/types';
import {durationOf} from '../shared/types';
const seconds=(ms:number)=>`${(ms/1000).toFixed(2)} 秒`;
export function ChangeList({changes}:{changes?:TextChange[]}){
 return <div className="text-change-list">{changes?.length?changes.map((c,i)=><div className="text-change" key={i}><strong>{c.target} · {c.field}</strong><p><span>当前</span>{c.before}</p><p><span>改为</span>{c.after}</p></div>):<p>此旧方案没有逐项改动清单，请重新提出修改建议。</p>}</div>;
}
export function TextPlanDetails({edl,assets}:{edl:EDL;assets:Asset[]}){
 return <section className="text-plan-details" aria-label="文字剪辑方案"><h4>镜头安排</h4>{edl.clips.some(c=>c.narration)&&<p>配音使用 Edge 在线语音，确认后提交以上文案生成声音。</p>}<p>{edl.clips.length} 个镜头 · {seconds(durationOf(edl))} · {edl.aspect_ratio} · {edl.subtitles?'文案字幕开启':'文案字幕关闭'}</p><ol>{edl.clips.map((c,i)=><li key={c.id}><strong>镜头 {i+1} · {assets.find(a=>a.id===c.asset_id)?.name||'所选素材'}</strong><span>源片 {seconds(c.start_ms)} – {seconds(c.end_ms)}</span><p>{c.purpose}</p>{c.narration&&<p>配音（{c.narration.language}）：{c.narration.text}</p>}{c.audio_source&&<p>保留口播：{assets.find(a=>a.id===c.audio_source?.asset_id)?.name} {seconds(c.audio_source.start_ms)} – {seconds(c.audio_source.end_ms)}</p>}{edl.subtitles&&c.caption&&<p>字幕：{c.caption}</p>}</li>)}</ol>{edl.subtitles&&edl.title&&<p>片头标题：{edl.title}</p>}{edl.subtitles&&edl.cta&&<p>结尾文案：{edl.cta}</p>}{edl.bgm&&<p>背景音乐：{edl.bgm.title} · {Math.round(edl.bgm.gain*100)}% · 从 {seconds(edl.bgm.start_ms)} 起播 · 循环铺满 / 淡入淡出{edl.bgm.ducking?' / 人声避让':''}</p>}<p>原声音量 {Math.round(edl.audio_gain*100)}%。确认以上内容后才生成视频预览。</p></section>;
}
