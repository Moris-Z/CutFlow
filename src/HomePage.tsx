import { useState } from 'react';
import { ArrowRight, Film, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import type { Asset, Brief, Task, TaskState } from '../shared/types';

export type CreativeStart = { request?: string; recipe?: Brief['recipe'] };
type Props = { assets: Asset[]; tasks: Task[]; busy: boolean; onStart: (value?: CreativeStart) => void; onUpload: () => void; onOpen: (id: string) => void; onProjects: () => void; onDelete:(task:Task)=>void; onTrash:()=>void;onSkills?:()=>void };
const status: Record<TaskState, string> = { DRAFT_BRIEF:'待生成方案', WAITING_PLAN_APPROVAL:'待确认方案', COMPILING:'正在制作', RENDERING_PREVIEW:'正在制作', QUALITY_CHECKING:'正在检查', WAITING_USER_REVIEW:'待看预览', REVISING:'正在调整', RENDERING_FINAL:'正在导出', DELIVERED:'已完成', FAILED:'需要处理', CANCELLED:'已暂停' };
const directions: { title: string; subtitle: string; image: string; recipe: Brief['recipe']; request: string }[] = [
  { title:'产品展示', subtitle:'看清细节，记住卖点', image:'skin-show.mp4', recipe:'demo', request:'做一支产品展示广告，完整展示使用过程和实际体验，突出产品细节。' },
  { title:'美食饮品', subtitle:'从诱人细节，到真实品尝', image:'pizza-hero.mp4', recipe:'detail', request:'做一支美食饮品广告，先展示诱人的细节，再展示制作和完整的品尝过程。' },
  { title:'生活方式', subtitle:'让产品走进日常', image:'travel-island.mp4', recipe:'story', request:'做一支生活方式广告，用连贯的场景和真实体验讲述一个小故事。' },
  { title:'运动户外', subtitle:'跟随动作，感受节奏', image:'run-start.mp4', recipe:'story', request:'做一支运动户外广告，突出行动和体验，保留关键动作的完整过程。' },
];

function ProjectCard({ task, assets, onOpen, onDelete, busy }: { task: Task; assets: Asset[]; onOpen: (id: string) => void; onDelete:(task:Task)=>void; busy:boolean }) {
  const cover = task.artifacts.find(a => a.kind === 'cover' && a.version === task.edl?.version)?.url;
  const asset = assets.find(a => a.id === (task.edl?.clips[0]?.asset_id || task.asset_ids[0]));
  return <article className="project-tile"><button className="project-tile-main" onClick={() => onOpen(task.id)}>
    <div className="project-tile-image">{cover || asset?.thumbnail_url ? <img loading="lazy" src={cover || asset?.thumbnail_url} alt=""/> : <Film size={30}/>}
      <span className={`project-tile-status ${task.state === 'FAILED' ? 'failed' : ''}`}>{task.pending_patch ? '待确认修改' : status[task.state]}</span>
      <span className="project-open"><ArrowRight size={18}/></span>
    </div>
    <div className="project-tile-text"><strong>{task.name}</strong><span>{task.is_demo ? '演示 · ' : ''}{task.brief.platform} · {Math.round(task.brief.duration_ms / 1000)} 秒</span></div>
  </button><button type="button" className="project-tile-delete" aria-label={`删除项目 ${task.name}`} title="删除项目" disabled={busy} onClick={()=>onDelete(task)}><Trash2 size={15}/></button></article>;
}

export function HomePage({ assets, tasks, busy, onStart, onUpload, onOpen, onProjects, onDelete, onSkills }: Props) {
  const [request, setRequest] = useState('');
  return <div className="home-page">
    <section className="home-hero">
      <div className="hero-light" aria-hidden="true"><span/><span/><span/></div>
      <div className="hero-content"><span className="hero-kicker"><Sparkles size={15}/> 你的广告视频创作助手</span><h1>让好素材，<br className="hero-mobile-break"/><span>成为好作品。</span></h1><p>上传素材，说说想法。让剪辑变简单。</p>
        <form className="home-composer" onSubmit={e => { e.preventDefault(); onStart({request}); }}>
          <label className="sr-only" htmlFor="home-request">想做什么广告视频？</label>
          <textarea id="home-request" value={request} onChange={e => setRequest(e.target.value)} placeholder="例如：把新品咖啡的素材，剪成一支 30 秒广告" rows={2} maxLength={8000}/>
          <div><button className="hero-upload" type="button" disabled={busy} onClick={() => { onStart({request}); onUpload(); }}><Plus size={17}/>上传素材</button><button type="submit" className="hero-submit" disabled={busy}>开始创作<ArrowRight size={17}/></button></div>
        </form>
        <ol className="home-steps"><li><span>1</span>上传素材</li><li><span>2</span>确认方案</li><li><span>3</span>预览与导出</li></ol>
      </div>
    </section>
    <section className="home-section"><div className="section-heading"><h2>从一个剪辑技能开始</h2><button className="text-button" onClick={onSkills}>探索全部技能<ArrowRight size={14}/></button></div><div className="direction-grid">{directions.map(d => {
      const asset = assets.find(a => a.name === d.image);
      return <button className="direction-card" key={d.title} disabled={busy} onClick={() => onStart({request:d.request,recipe:d.recipe})}>
        <div className="direction-cover">{asset ? <img loading="lazy" src={asset.thumbnail_url} alt=""/> : <Film size={32}/>}<span><ArrowRight size={16}/></span></div>
        <strong>{d.title}</strong><small>{d.subtitle}</small>
      </button>;
    })}</div></section>
    <section className="home-section"><div className="section-heading"><h2>最近项目</h2>{tasks.length > 0 && <button className="text-button" onClick={onProjects}>查看全部<ArrowRight size={14}/></button>}</div>{tasks.length ? <div className="project-grid">{tasks.slice(0,4).map(t => <ProjectCard key={t.id} task={t} assets={assets} onOpen={onOpen} onDelete={onDelete} busy={busy}/>)}</div> : <div className="projects-empty"><Film size={26}/><p>你的第一支广告视频，从这里开始。</p><button className="button" disabled={busy} onClick={() => onStart()}>开始创作<Plus size={16}/></button></div>}</section>
  </div>;
}

export function ProjectsPage({ assets, tasks, busy, onStart, onOpen, onDelete, onTrash }: Omit<Props,'onUpload'|'onProjects'>) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const filtered = tasks.filter(t => t.name.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || (filter === 'done' ? t.state === 'DELIVERED' : t.state !== 'DELIVERED')));
  return <section className="projects-page"><div className="page-heading"><div><h1>我的项目</h1><p>继续创作，或查看已完成的视频。</p></div><div className="page-actions"><button className="button subtle" onClick={onTrash}><Trash2 size={15}/>最近删除</button><button className="button primary" disabled={busy} onClick={() => onStart()}><Plus size={16}/>开始创作</button></div></div>
    <div className="project-filters"><div role="group" aria-label="项目状态">{[['all','全部'],['ongoing','进行中'],['done','已完成']].map(([id,label]) => <button key={id} className={filter === id ? 'selected' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div><label><Search size={16}/><input aria-label="搜索项目" placeholder="搜索项目" value={query} onChange={e => setQuery(e.target.value)}/></label></div>
    {filtered.length ? <div className="project-grid">{filtered.map(t => <ProjectCard key={t.id} task={t} assets={assets} onOpen={onOpen} onDelete={onDelete} busy={busy}/>)}</div> : <div className="projects-empty"><Film size={26}/><p>{tasks.length ? '没有找到符合条件的项目' : '还没有项目，开始创建第一支视频吧'}</p></div>}
  </section>;
}
