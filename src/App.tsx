import {getSkill,skillName,type SkillId} from '../shared/skills';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, AudioLines, Check, ChevronDown, ChevronRight, CircleCheck, CircleHelp, Clapperboard, Clock3, FileJson, Film, FolderOpen, Layers3, LoaderCircle, LockKeyhole, Maximize2, MessageSquare, PencilLine, Play, Plus, RefreshCw, ScanEye, Scissors, Settings2, ShieldCheck, Sparkles, UnlockKeyhole, Upload, WandSparkles, X, Trash2, RotateCcw } from 'lucide-react';
import type { Asset, Artifact, Brief, Clip, Settings, Shot, ShotIntent, Task, TaskState, MusicLibrary, TrashItem, TrashKind } from '../shared/types';
import { durationOf } from '../shared/types';
import {MusicPicker,MusicLibraryPage,ProjectMusic} from './MusicPicker';
import { TextPlanDetails } from './TextPlanDetails';
import { PatchPreviewCard } from './PatchPreviewCard';
import { RecipeMatchView, AdRoleEditor } from './RecipePicker';
import { recipeName, type RecipeId } from '../shared/recipes';
import { CreationPage } from './CreationPage';
import { SkillsPage } from './SkillsPage';
import { emptyDraft, restoreDraft, applySkill, parseRoute, routeHash, type PageView, type PageRoute } from './creation';
import { api, post } from './api';
import { SelectControl } from './SelectControl';
import { SettingsForm } from './SettingsForm';
import {PreparationCard} from './PreparationCard';
import { PlanApprovalAction } from './PlanApprovalAction';
import { ProjectsPage, type CreativeStart } from './HomePage';

const stateNames: Record<TaskState, string> = { DRAFT_BRIEF: '待生成方案', WAITING_PLAN_APPROVAL: '待确认方案', COMPILING: '准备制作', RENDERING_PREVIEW: '生成预览中', QUALITY_CHECKING: '检查成片中', WAITING_USER_REVIEW: '待看预览', REVISING: '调整方案中', RENDERING_FINAL: '导出成片中', DELIVERED: '已交付', FAILED: '运行失败', CANCELLED: '已取消' };
const renderingStates = new Set<TaskState>(['COMPILING', 'RENDERING_PREVIEW', 'QUALITY_CHECKING', 'REVISING', 'RENDERING_FINAL']);
const scenarioNames = { montage: '产品混剪', talking_head: '口播剪辑', highlight: '精彩片段', scripted: '脚本成片', beat: '节奏剪辑' };
const evidenceNames = { metadata: '文件元数据', user_annotation: '人工注释', model_audio: '语音转写',model_vision: '模型视觉分析', demo: '演示素材' };
const time = (ms: number) => { const secs = Math.max(0, ms / 1000); return `${Math.floor(secs / 60).toString().padStart(2, '0')}:${(secs % 60).toFixed(1).padStart(4, '0')}`; };
const shortDate = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>('input, button, textarea, select')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const elements = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary') || []).filter(element => element.getClientRects().length > 0);
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={root} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={18} /></button></div>{children}</div></div>;
}

function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) { return <span className={`badge ${tone}`}>{children}</span>; }

function frozenShotForClip(task: Task, clip: Clip): Shot | undefined {
  const shots = task.asset_shots?.[clip.asset_id] || [];
  if (clip.shot_id) return shots.find(shot => shot.id === clip.shot_id);
  const candidates = shots.filter(shot => shot.start_ms <= clip.start_ms && shot.end_ms >= clip.end_ms && shot.evidence.type === clip.evidence.type && shot.evidence.description === clip.evidence.description);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function ClipIntent({ task, clip }: { task: Task; clip: Clip }) {
  const shot = frozenShotForClip(task, clip), intent = shot?.intent;
  if (!intent) return <div className="clip-intent needs-review"><strong><CircleHelp size={13} />关键信息待审阅</strong><p>当前项目未记录这段镜头的关键动作与完整时间范围。请观看源素材，确认观众确实看到了你要表达的内容。</p></div>;
  const start = intent.action_start_ms - intent.pre_roll_ms, end = intent.action_end_ms + intent.post_roll_ms;
  const protectedRange = clip.start_ms <= start && clip.end_ms >= end;
  return <div className={`clip-intent ${protectedRange ? '' : 'needs-review'}`}><strong>{protectedRange ? <ShieldCheck size={13} /> : <CircleHelp size={13} />}{protectedRange ? '已保留标注的关键动作' : '关键动作未完整保留'}</strong><p><b>观众应理解：</b>{intent.message}</p><p><b>关键动作：</b>{intent.key_action}</p><dl><div><dt>动作时间</dt><dd>{time(intent.action_start_ms)} – {time(intent.action_end_ms)}</dd></div><div><dt>保护范围</dt><dd>{time(start)} – {time(end)} · 含铺垫与反应</dd></div></dl><small>{intent.required ? '必须保留' : '可整段舍弃，不能截断关键动作'} · 优先级 {intent.priority}/5 · 依据项目创建方案时的标注</small><details><summary>查看连续动作的观察依据</summary><p>{intent.evidence.description}</p><small>已观察源素材：{intent.evidence.observed_at_ms.map(time).join('、')}</small></details></div>;
}

function EditorialReviewCard({ task }: { task: Task }) {
  if (!task.edl) return null;
  const review = task.plan?.edl.version === task.edl.version ? task.plan.editorial_review : undefined;
  const items = review?.items || task.edl.clips.map(clip => {
    const intent = frozenShotForClip(task, clip)?.intent;
    const protectedRange = intent && clip.start_ms <= intent.action_start_ms - intent.pre_roll_ms && clip.end_ms >= intent.action_end_ms + intent.post_roll_ms;
    return { clip_id: clip.id, status: protectedRange ? 'protected' as const : 'unverified' as const, message: protectedRange ? `${intent.key_action}：已保留完整动作及铺垫、反应。` : '缺少已验证的完整动作范围，需要观看源素材和成片确认。' };
  });
  const protectedCount = items.filter(item => item.status === 'protected').length;
  return <div className="editorial-review"><div className="message-label"><ScanEye size={14} />镜头关键信息<Badge tone={protectedCount === items.length ? 'green' : 'amber'}>{protectedCount === items.length ? '动作范围已保护' : '需要内容审阅'}</Badge></div><p>先完整表达每个镜头的意义，再分配时长和节奏。</p><div className="editorial-items">{items.map(item => <div key={item.clip_id}><span className={item.status}>{item.status === 'protected' ? <ShieldCheck size={13} /> : <CircleHelp size={13} />}</span><p><strong>镜头 {task.edl!.clips.findIndex(clip => clip.id === item.clip_id) + 1}</strong>{item.message}</p></div>)}</div><small>保护范围来自时间码标注，不代表模型已自动识别动作；文件技术检查不能证明“人已喝到咖啡”。</small></div>;
}

export default function App() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const availableAssets=assets.filter(a=>!a.deleted_at);
  const [trash,setTrash]=useState<TrashItem[]>([]);
  const [trashFilter,setTrashFilter]=useState<TrashKind|'all'>('all');
  const [deletion,setDeletion]=useState<{kind:TrashKind;id:string;name:string}>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [music,setMusic]=useState<MusicLibrary>();
  const [recentIds,setRecentIds]=useState<string[]>(()=>{try{const value=JSON.parse(localStorage.getItem('cutflow-recent-projects')||'[]');return Array.isArray(value)?value.filter(id=>typeof id==='string').slice(0,8):[];}catch{return [];}});
  const [projectsExpanded,setProjectsExpanded]=useState(true);
  const [settings, setSettings] = useState<Settings>();
  const [route,setRoute]=useState<PageRoute>(()=>parseRoute(window.location.hash));
  const {view,projectId:activeId,skillId}=route;
  const navigate=(next:PageRoute)=>{setRoute(next);const hash=routeHash(next);if(window.location.hash!==hash)window.history.pushState(null,'',hash);};
  const setView=(view:PageView)=>navigate({view,...((view==='workspace'||view==='trace')?{projectId:activeId}:{})});
  const [draft,setDraft]=useState(()=>{try{return restoreDraft(sessionStorage.getItem('cutflow-creation-draft'));}catch{return emptyDraft();}});
  useEffect(()=>{try{sessionStorage.setItem('cutflow-creation-draft',JSON.stringify(draft));}catch{/* The current draft remains in memory when browser storage is unavailable. */}},[draft]);
  useEffect(()=>{const restore=()=>setRoute(parseRoute(window.location.hash));window.addEventListener('popstate',restore);window.addEventListener('hashchange',restore);return()=>{window.removeEventListener('popstate',restore);window.removeEventListener('hashchange',restore);};},[]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<'settings' | 'versions' | 'project-music' | 'delete' | 'trash' | null>(null);
  const [editingAsset, setEditingAsset] = useState<Asset>();
  const [selectedClipId, setSelectedClipId] = useState<string>();
  const [sourceAssetId, setSourceAssetId] = useState<string>();
  const [rightTab, setRightTab] = useState<'agent' | 'brief'>('agent');
  const [feedback, setFeedback] = useState('');
  const [revisionClip, setRevisionClip] = useState('');
  const [playhead, setPlayhead] = useState(0);
  const [showEvidence, setShowEvidence] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<Asset>();
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const agentBodyRef=useRef<HTMLDivElement>(null);
  const task = tasks.find(t => t.id === activeId);
  const selectedClip = task?.edl?.clips.find(c => c.id === selectedClipId);
  const taskAssets = task ? assets.filter(a => task.asset_ids.includes(a.id)) : assets;
  const sourceAsset = assets.find(a => a.id === (sourceAssetId || selectedClip?.asset_id));
  const patchActive = !!task?.pending_patch?.preview && ['queued','rendering'].includes(task.pending_patch.preview.status);
  const fullActive = !!task && renderingStates.has(task.state);
  const preparing=!!task?.preparation&&['queued','searching','planning'].includes(task.preparation.status);
  const active = fullActive || patchActive || preparing;
  const currentArtifacts = task?.artifacts.filter(a => a.version === task.edl?.version) || [];
  const preview = currentArtifacts.find(a => a.kind === 'final') || currentArtifacts.find(a => a.kind === 'preview');
  const clipStart = selectedClip && task?.edl ? task.edl.clips.slice(0, task.edl.clips.findIndex(c => c.id === selectedClip.id)).reduce((sum, c) => sum + c.end_ms - c.start_ms, 0) : 0;

  const refresh = useCallback(async () => {
    const [nextAssets, nextTasks, nextSettings, nextMusic, nextTrash] = await Promise.all([api<Asset[]>('/assets?include_deleted=true'), api<Task[]>('/tasks'), api<Settings>('/settings'),api<MusicLibrary>('/music'),api<TrashItem[]>('/trash')]);
    setAssets(nextAssets); setTasks(nextTasks); setSettings(nextSettings);setMusic(nextMusic);setTrash(nextTrash);
  }, []);
  useEffect(() => { refresh().catch(e => setError(e.message)).finally(() => setLoading(false)); }, [refresh]);
  useEffect(() => {
    if (!task || !active) return;
    let stopped = false;
    let pending = false;
    const timer = window.setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        const updated = await api<Task>(`/tasks/${task.id}`);
        if (!stopped) {setTasks(current => current.map(t => t.id === updated.id ? updated : t));if(updated.asset_ids.some(id=>!assets.some(a=>a.id===id)))setAssets(await api<Asset[]>('/assets?include_deleted=true'));}
      } catch (e) { if (!stopped) setError((e as Error).message); }
      finally { pending = false; }
    }, 1500);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [task?.id, task?.state, active]);
  useEffect(() => { setSelectedClipId(undefined); setSourceAssetId(undefined); setPlayhead(0); setFeedback(''); setRevisionClip(''); }, [activeId]);
  useEffect(() => { window.scrollTo({top:0,left:0,behavior:'instant'}); }, [view, activeId, skillId]);
  useEffect(()=>{if(!loading)setDraft(current=>{const assetIds=current.assetIds.filter(id=>assets.some(a=>a.id===id&&!a.deleted_at));return assetIds.length===current.assetIds.length?current:{...current,assetIds};});},[assets,loading]);
  useEffect(() => { if (notice) { const timer = window.setTimeout(() => setNotice(''), 4500); return () => window.clearTimeout(timer); } }, [notice]);
  useEffect(()=>{
    if(view!=='workspace'||rightTab!=='agent'||task?.pending_patch)return;
    const node=agentBodyRef.current?.querySelector('.plan-disclosure'),parent=agentBodyRef.current;
    if(node&&parent)parent.scrollTo({top:parent.scrollTop+node.getBoundingClientRect().top-parent.getBoundingClientRect().top-18,behavior:'instant'});
  },[view,rightTab,task?.id,task?.plan?.edl.version,task?.pending_patch?.id]);
  useEffect(()=>{
    if(view==='workspace'&&rightTab==='agent'&&!task?.edl){const parent=agentBodyRef.current;parent?.scrollTo({top:parent.scrollHeight,behavior:'instant'});}
  },[view,rightTab,task?.id,task?.edl,task?.preparation?.messages.length,task?.preparation?.message]);
  const closeModal = useCallback(() => setModal(null), []);
  const closeAnnotations = useCallback(() => setEditingAsset(undefined), []);

  async function run(label: string, action: () => Promise<unknown>, success?: string) {
    if (busy) return;
    setBusy(label); setError('');
    try { await action(); await refresh(); if (success) setNotice(success); return true; }
    catch (e) { setError((e as Error).message || '操作失败，请重试'); return false; }
    finally { setBusy(''); }
  }
  async function taskAction(action: string, payload: unknown = {}) {
    if (!task) return;
    return await run(action, async () => { await post<Task>(`/tasks/${task.id}/${action}`, payload); });
  }
  async function upload(files: FileList | null) {
    if (!files?.length||view==='workspace'&&preparing) return;
    const form = new FormData(); Array.from(files).forEach(file => form.append('files', file));
    const project=view==='workspace'&&task&&!task.edl?task:undefined;
    const ok = await run('upload', async () => { const imported = await api<Asset[]>('/assets', { method: 'POST', body: form });if(project){await post(`/tasks/${project.id}/brief`,{asset_ids:imported.map(a=>a.id)});}else setDraft(current=>({...current,assetIds:[...new Set([...current.assetIds,...imported.map(a=>a.id)])].slice(0,12)})); }, '素材已导入');
    if (ok&&!project) setView('create');
    if (inputRef.current) inputRef.current.value = '';
  }
  function startProject(value:CreativeStart={}) {
    setError('');setModal(null);
    if(value.recipe!==undefined||value.request?.trim())setDraft(current=>({...current,skillPrompt:'',brief:{...current.brief,...(value.recipe?{recipe:value.recipe}:{}),...(value.request?.trim()?{request:value.request}:{})}}));
    setView('create');
  }
  function useSkill(id:SkillId){if(busy||getSkill(id)?.unavailable)return;setDraft(current=>applySkill(current,id));setError('');setView('create');}
  async function createFromConversation(){
    if(busy)return;
    await run('create',async()=>{
      const created=await post<Task>('/tasks',{...(draft.name.trim()?{name:draft.name.trim()}:{}),brief:{...draft.brief,request:draft.brief.request.trim()},asset_ids:draft.assetIds,prepare:true});
      setTasks(current=>[created,...current]);setDraft(emptyDraft());openProject(created.id);
    });
  }
  function openSettings(){setError('');setModal('settings');}
  function requestDelete(kind:TrashKind,id:string,name:string){setError('');setDeletion({kind,id,name});setModal('delete');}
  function openTrash(kind:TrashKind){setError('');setTrashFilter(kind);setModal('trash');}
  async function confirmDelete(){if(!deletion)return;const item=deletion;await run('delete',async()=>{await api(`/${item.kind}/${item.id}`,{method:'DELETE'});if(item.kind==='tasks'&&activeId===item.id){setView('projects');}setModal(null);setDeletion(undefined);},'已移入最近删除，可随时恢复');}
  function openProject(id:string){setRecentIds(current=>{const next=[id,...current.filter(value=>value!==id)].slice(0,8);try{localStorage.setItem('cutflow-recent-projects',JSON.stringify(next));}catch{}return next;});navigate({view:'workspace',projectId:id});setRightTab('agent');}
  async function launchDemo() {
    await run('demo', async () => { const created = await post<Task>('/demo'); openProject(created.id); }, '已创建演示项目。确认方案后会真实渲染本地示例素材。');
  }
  function selectClip(clip: Clip) {
    setSelectedClipId(clip.id); setSourceAssetId(undefined);
    const idx = task!.edl!.clips.findIndex(c => c.id === clip.id);
    const seek = task!.edl!.clips.slice(0, idx).reduce((sum, c) => sum + c.end_ms - c.start_ms, 0);
    if (videoRef.current && preview) videoRef.current.currentTime = seek / 1000;
    setPlayhead(seek);
  }
  const artifactNames: Record<Artifact['kind'], string> = { music_credits:'音乐署名与许可', preview: '预览视频', final: '高清成片', cover: '视频封面', subtitles: '字幕 SRT', edl: '剪辑方案 EDL', manifest: '交付清单', trace: '执行记录 Trace' };

  return <div className={`app-shell ${view === 'create' ? 'is-compose' : ''} ${view==='workspace'?'is-studio':''}`}>
    <input ref={inputRef} className="sr-only" type="file" accept="video/*,.mkv,.mov,.mp4,.webm" multiple onChange={e => void upload(e.target.files)} aria-label="上传视频素材" />
    <aside className="sidebar">
      <a className="brand" href="#create" onClick={e => { e.preventDefault(); setView('create'); }} aria-label="CutFlow 创作"><span className="brand-mark"><Scissors size={19} strokeWidth={2.3} /></span><span>CutFlow<span className="brand-dot">.</span></span></a>
      <nav aria-label="主导航">
        <button title="创作" aria-label="创作" className={`nav-item ${view==='create'?'selected':''}`} onClick={()=>startProject()}><Plus size={19}/><span>创作</span></button>
        <button title="剪辑技能" aria-label="剪辑技能" className={`nav-item ${view==='skills'?'selected':''}`} onClick={()=>setView('skills')}><WandSparkles size={18}/><span>剪辑技能</span></button>
        <button title="素材库" aria-label="素材库" className={`nav-item ${view==='assets'?'selected':''}`} onClick={()=>setView('assets')}><FolderOpen size={18}/><span>素材库</span></button>
        <button title="配乐库" aria-label="配乐库" className={`nav-item ${view==='music'?'selected':''}`} onClick={()=>setView('music')}><AudioLines size={18}/><span>配乐库</span></button>
      </nav>
      <button className={`nav-item mobile-project-entry ${view==='projects'?'selected':''}`} aria-label="项目" title="项目" onClick={()=>setView('projects')}><FolderOpen size={18}/><span>项目</span></button>
      <div className="sidebar-projects">
        <div className="sidebar-section-heading"><button aria-expanded={projectsExpanded} onClick={()=>setProjectsExpanded(!projectsExpanded)}><ChevronDown size={13}/><span>项目</span><small>{tasks.length}</small></button><button className="icon-button" aria-label="管理所有项目" title="管理所有项目" onClick={()=>setView('projects')}><FolderOpen size={14}/></button></div>
        {projectsExpanded&&<div className="sidebar-all-projects">{[...tasks].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')).map(t=><button key={t.id} className={`project-item ${t.id===activeId?'selected':''}`} onClick={()=>openProject(t.id)}><FolderOpen size={14}/><strong title={t.name}>{t.name}</strong></button>)}{!tasks.length&&<p>作品会保存在这里</p>}</div>}
        <div className="sidebar-section-heading"><span>最近项目</span></div>
        <div className="project-list">{(recentIds.length?recentIds.map(id=>tasks.find(t=>t.id===id)).filter((t):t is Task=>!!t):tasks).slice(0,4).map(t=><button key={t.id} className={`project-item ${t.id===activeId?'selected':''}`} onClick={()=>openProject(t.id)}><span className={`project-status ${renderingStates.has(t.state)?'pulsing':''}`}/><span><strong title={t.name}>{t.name}</strong></span></button>)}</div>
      </div>
      <div className="sidebar-bottom"><button title="设置" aria-label="设置" className="nav-item settings-link" onClick={openSettings}><Settings2 size={18}/><span>设置</span></button><div className="profile"><span className="avatar">C</span><div>我的工作空间</div></div></div>
    </aside>

    <main className="main-shell">
      <header className="topbar"><div className="breadcrumb"><span>工作空间</span><ChevronRight size={13} /><strong>{view === 'create' ? '创作' : view === 'skills' ? '剪辑技能' : view === 'projects' ? '我的项目' : view === 'assets' ? '素材库' : view === 'music' ? '配乐库' : view === 'trace' ? '制作记录' : task?.name || '视频创作'}</strong>{task?.is_demo && view === 'workspace' && <Badge tone="amber">演示</Badge>}</div><div className="topbar-actions">{tasks.length > 0 && <select className="mobile-project-select" aria-label="切换剪辑项目" value={activeId || ''} onChange={e => { if(e.target.value)openProject(e.target.value);else setView('create'); }}><option value="">选择项目</option>{tasks.map(t => <option key={t.id} value={t.id}>{t.is_demo ? '[演示] ' : ''}{t.name}</option>)}</select>}<span className="save-indicator">广告视频工作空间</span><button className="icon-button" onClick={() => void run('refresh', refresh)} disabled={!!busy} aria-label="刷新工作台"><RefreshCw size={15} className={busy === 'refresh' ? 'spin' : ''} /></button></div></header>
      {error && <div className="alert error" role="alert"><CircleHelp size={17} /><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="关闭错误"><X size={16} /></button></div>}
      {notice && <div className="toast" role="status"><CircleCheck size={17} />{notice}</div>}
      {loading ? <div className="loading-screen"><LoaderCircle className="spin" size={25} /><p>正在连接创作空间…</p></div> : <>
      {view==='create'?<CreationPage draft={draft} onChange={setDraft} assets={availableAssets} library={music} settings={settings} busy={busy} onUpload={()=>inputRef.current?.click()} onSkill={useSkill} onSubmit={()=>void createFromConversation()}/>:view==='skills'?<SkillsPage selected={skillId} onOpen={id=>navigate({view:'skills',skillId:id})} onUse={useSkill} onBack={()=>setView('skills')}/>:view === 'projects' ? <ProjectsPage onDelete={t=>requestDelete('tasks',t.id,t.name)} onTrash={()=>openTrash('tasks')} assets={assets} tasks={tasks} busy={!!busy} onStart={startProject} onOpen={openProject}/> : view === 'music' ? <MusicLibraryPage onDelete={t=>requestDelete('music',t.id,t.title)} onTrash={()=>openTrash('music')} library={music} onRefresh={refresh} onDefault={id=>run('default-music',async()=>{await post('/settings',{default_bgm_id:id});},'默认配乐已更新，之后的新方案会使用此音乐')}/> : view === 'assets' ? <section className="library-page"><div className="page-heading"><div><h1>素材库<span className="heading-count">{availableAssets.length}</span></h1><p>管理用于广告视频的原始素材。</p></div><div className="page-actions"><button className="button subtle" onClick={()=>openTrash('assets')}><Trash2 size={15}/>最近删除</button><button className="button primary" onClick={() => inputRef.current?.click()} disabled={!!busy}><Upload size={16} />{busy === 'upload' ? '正在导入…' : '导入素材'}</button></div></div><AssetGrid onDelete={a=>requestDelete('assets',a.id,a.name)} assets={availableAssets} busy={busy} onPreview={setPreviewAsset} onEdit={setEditingAsset} onAnalyze={a => void run(`analyze-${a.id}`, async () => { const proposed=await post<Asset>(`/assets/${a.id}/analyze-actions`);setEditingAsset(proposed); }, '多帧分析建议已打开，请核对关键动作后保存')} modelConfigured={!!settings?.model_configured} /><div className="library-tip"><ScanEye size={18} /><p>素材分析由你触发。动作分析会向已配置的模型服务发送最多 16 张有序采样帧；建议必须经你核对保存；未启用模型时，仅使用元数据和你提供的注释。</p></div></section> : view === 'trace' ? <section className="trace-page"><div className="page-heading"><div><span className="eyebrow">EVERY DECISION, TRACEABLE</span><h1>运行记录</h1><p>查看当前项目的执行事件、剪辑版本与交付文件。</p></div>{task && <a className="button" href={`/api/tasks/${task.id}/trace`} download><ArrowDownToLine size={16} />下载制作记录</a>}</div>{task ? <><div className="trace-summary"><strong>{task.name}</strong><Badge>{stateNames[task.state]}</Badge><span>{task.events.length} 条真实执行事件</span></div><div className="trace-events">{task.events.length ? task.events.map(event => <div className="trace-event" key={event.id}><span className="trace-dot" /><time>{shortDate(event.at)}</time><div><strong>{event.message}</strong><small>{event.stage} · {event.type}</small>{event.data && <details><summary>查看事件数据</summary><pre>{JSON.stringify(event.data, null, 2)}</pre></details>}</div></div>) : <p className="muted">项目尚无执行记录。</p>}</div></> : <SimpleEmpty icon={<Layers3 size={32} />} title="创作过程，都有迹可循" text="选择一个项目后，在这里查看真实执行记录。" />}</section> : <>
        <div className="workspace-title"><div><button className="text-button workspace-back" onClick={() => setView('projects')}><ArrowLeft size={14}/>我的项目</button><h1>{task ? task.name : '把想法，剪成故事。'}</h1><p>{task ? <><Badge tone={task.state === 'FAILED' ? 'red' : 'green'}>{stateNames[task.state]}</Badge><span>{scenarioNames[task.brief.scenario]}<i />{task.brief.aspect_ratio}<i />{task.brief.resolution}<i />{task.brief.duration_ms / 1000} 秒目标</span></> : '从一句创意开始，让 Agent 完成繁琐的剪辑。你来决定每一个精彩瞬间。'}</p></div><div className="workspace-title-actions"><button className="button subtle" onClick={() => setView('trace')}><Layers3 size={15}/>制作记录</button>{task && <button className="button subtle" disabled={!task.versions.length} onClick={() => setModal('versions')}><Clock3 size={15} />版本 {task.edl ? `v${task.edl.version}` : ''}</button>}{task?.state === 'DELIVERED' && preview ? <a href={preview.url} download className="button primary"><ArrowDownToLine size={16} />下载成片</a> : <button className="button" disabled={!!busy||preparing} onClick={() => inputRef.current?.click()}><Plus size={16} />导入素材</button>}</div></div>
        {task?.variant_group&&<nav className="project-variants" aria-label="本组视频版本">{tasks.filter(t=>t.variant_group?.id===task.variant_group!.id).sort((a,b)=>a.variant_group!.index-b.variant_group!.index).map(t=><button key={t.id} className={t.id===task.id?'selected':''} onClick={()=>openProject(t.id)}>{t.variant_group!.label}</button>)}</nav>}
        {task && <ol className="workspace-steps" aria-label="视频制作进度">{['确认方案','预览与调整','导出视频'].map((label,index) => { const step = task.state === 'DELIVERED' || task.state === 'RENDERING_FINAL' ? 2 : ['DRAFT_BRIEF','WAITING_PLAN_APPROVAL'].includes(task.state) ? 0 : 1; return <li key={label} aria-current={step===index ? 'step' : undefined} className={index<=step ? 'current' : ''}><span>{index < step ? <Check size={12}/> : index+1}</span>{label}</li>; })}</ol>}
        <div className={`studio-grid ${task && ['DRAFT_BRIEF','WAITING_PLAN_APPROVAL'].includes(task.state) ? 'plan-stage' : ''}`}>
          <section className="editor-area">
            {task && <label className="text-display-control"><span><strong>文案字幕</strong><small>{fullActive ? '正在生成当前设置的预览…' : '在视频画面显示字幕。'}{task.edl?.clips.some(c=>c.locked) ? '请先解锁镜头再修改。' : task.pending_patch ? '请先处理待确认修改。' : task.edl && task.plan_approved_version===task.edl.version ? '切换后重新生成预览。' : '设置随剪辑方案生效。'}</small></span><input type="checkbox" role="switch" aria-label="文案字幕" checked={task.edl?.subtitles ?? task.brief.subtitles ?? false} disabled={!!busy || active || !!task.pending_patch || task.edl?.clips.some(c=>c.locked)} onChange={e=>void taskAction('text-display',{enabled:e.target.checked,version:task.edl?.version ?? 0})} /></label>}
            <div className="preview-panel"><div className="panel-heading"><div><span className="tiny-dot" />{sourceAsset && (sourceAssetId || !preview) ? '源素材预览' : '视频预览'}{task?.edl && <span className="version-tag">v{task.edl.version}</span>}</div><div className="preview-meta">{sourceAsset && (sourceAssetId || !preview) ? `${sourceAsset.width} × ${sourceAsset.height}` : task ? `${task.brief.aspect_ratio} · ${task.brief.fps} FPS` : '你的下一支作品'}<button className="icon-button" aria-label="全屏预览" disabled={!preview && !sourceAsset} onClick={() => void videoRef.current?.requestFullscreen().catch(e => setError(e.message))}><Maximize2 size={14} /></button></div></div>
              <div className={`preview-stage ${!preview && !sourceAsset ? 'empty-stage' : ''}`}>
                {sourceAssetId && sourceAsset ? <video ref={videoRef} key={sourceAsset.url} controls playsInline src={sourceAsset.url} poster={sourceAsset.thumbnail_url} aria-label={`${sourceAsset.name} 原始视频`} /> : preview ? <video ref={videoRef} key={preview.url} controls playsInline src={preview.url} poster={currentArtifacts.find(a=>a.kind==='cover')?.url || taskAssets.find(a=>a.id===task?.edl?.clips[0]?.asset_id)?.thumbnail_url} aria-label="当前版本视频预览" onTimeUpdate={e => setPlayhead(e.currentTarget.currentTime * 1000)} /> : sourceAsset ? <video ref={videoRef} key={sourceAsset.url} controls playsInline src={sourceAsset.url} poster={sourceAsset.thumbnail_url} onLoadedMetadata={e => { e.currentTarget.currentTime = (selectedClip?.start_ms || 0) / 1000; }} aria-label="所选镜头原始素材" /> : <div className="preview-empty"><div className="film-illustration" aria-hidden="true"><div className="film-card back"><span /><span /><span /></div><div className="film-card front"><div className="film-landscape"><span className="sun" /><span className="hill hill-one" /><span className="hill hill-two" /><span className="play-circle"><Play size={19} fill="currentColor" /></span></div><div className="film-lines"><span /><span /></div></div><span className="spark spark-one">✦</span><span className="spark spark-two">✦</span></div><h2>{task ? task.edl?'先确认方案，再看视频':'从你的想法开始' : '每段素材，都值得被看见'}</h2><p>{task ? task.edl?'确认剪辑方案后，即可生成视频预览。':'与 Agent 确认需求，素材和方案会显示在这里。' : '导入视频，描述想法。其余的，交给你的剪辑搭档。'}</p><div className="empty-actions">{task ? <button className="button" onClick={() => setRightTab('agent')}><WandSparkles size={16} />{task?.edl?'查看剪辑方案':'与 Agent 对话'}</button> : <><button className="button primary" disabled={!!busy||preparing} onClick={() => inputRef.current?.click()}><Upload size={16} />导入我的素材</button><button className="text-button" disabled={!!busy} onClick={() => void launchDemo()}>{busy === 'demo' ? <LoaderCircle size={15} className="spin" /> : <Play size={14} />}体验演示项目<ArrowRight size={14} /></button></>}</div>{!task && <small className="empty-supported">支持 MP4、MOV、WebM 等视频格式 · 最多 12 个文件</small>}</div>}
                {fullActive && <div className="render-overlay"><div className="render-indicator"><LoaderCircle className="spin" size={22} /><strong>{stateNames[task!.state]}</strong><span>{Math.round(task!.progress)}%</span><div className="progress-track"><div style={{ width: `${Math.min(100, Math.max(0, task!.progress))}%` }} /></div><small>处理在本地进行，完成后预览会自动更新。</small></div></div>}
              </div>
              <div className="preview-footer"><span><span className={`status-led ${preview ? 'ready' : ''}`} />{sourceAssetId && sourceAsset ? sourceAsset.name : preview ? `${preview.kind === 'final' ? '高清成片' : '预览成片'} · 当前版本` : task ? '等待当前版本预览' : '准备开始创作'}</span>{sourceAssetId && preview && <button className="text-button small return-preview" onClick={() => setSourceAssetId(undefined)}><ArrowLeft size={11} />返回成片</button>}<span className="time-display">{time(playhead)}<span> / {time(task?.edl ? durationOf(task.edl) : sourceAsset?.duration_ms || 0)}</span></span></div>
            </div>

            {task?.edl && <div className="timeline-panel"><div className="panel-heading"><div><Film size={16} />视频片段<span className="count-label">{task?.edl?.clips.length || 0} 个镜头</span></div><button className="text-button small" disabled={!task?.edl} onClick={() => setShowEvidence(value => !value)}><ScanEye size={14} />{showEvidence ? '收起详情' : '片段详情'}</button></div>{task?.edl ? <><div className="timeline-ruler"><span>00:00</span><span>{time(durationOf(task.edl) / 4)}</span><span>{time(durationOf(task.edl) / 2)}</span><span>{time(durationOf(task.edl) * .75)}</span><span>{time(durationOf(task.edl))}</span></div><div className="timeline-clips">{task.edl.clips.map((clip, index) => { const asset = assets.find(a => a.id === clip.asset_id); return <button key={clip.id} onClick={() => selectClip(clip)} className={`timeline-clip ${selectedClipId === clip.id ? 'selected' : ''} ${task.pending_patch?.scope?.clip_ids.includes(clip.id) ? 'revision-scope' : ''}`} style={{ flexGrow: Math.max(1, (clip.end_ms - clip.start_ms) / 1000) }} aria-label={`镜头 ${index + 1}：${clip.purpose}`}><div className="clip-image" style={asset?.thumbnail_url ? { backgroundImage: `url(${JSON.stringify(asset.thumbnail_url)})` } : {}}><span>{String(index + 1).padStart(2, '0')}</span>{clip.locked && <LockKeyhole size={12} />}</div><div className="clip-description"><strong>{clip.purpose || `镜头 ${index + 1}`}</strong><small>{((clip.end_ms - clip.start_ms) / 1000).toFixed(1)}s</small></div></button>; })}</div><div className="audio-lane music-lane"><AudioLines size={14}/><span>{task.edl.bgm?`配乐 · ${task.edl.bgm.title}`:'尚未添加配乐'}</span><span>{task.edl.bgm?`${Math.round(task.edl.bgm.gain*100)}%`: ''}</span><button className="text-button small" disabled={!!busy||active||!!task.pending_patch} onClick={()=>setModal('project-music')}>更换配乐</button></div><div className="audio-lane"><AudioLines size={14} /><span>原素材音轨</span><div className="audio-pattern" aria-hidden="true" /><span>{Math.round(task.edl.audio_gain * 100)}%</span></div>{showEvidence && selectedClip && <div className="clip-inspector"><div className="inspector-heading"><strong>镜头 {task.edl.clips.findIndex(c => c.id === selectedClip.id) + 1} · {selectedClip.purpose}</strong><button className={`button compact ${selectedClip.locked ? 'locked' : ''}`} disabled={!!busy || active || !!task.pending_patch} onClick={() => void taskAction('lock', { clip_id: selectedClip.id, locked: !selectedClip.locked, version: task.edl!.version })}>{selectedClip.locked ? <LockKeyhole size={13} /> : <UnlockKeyhole size={13} />}{selectedClip.locked ? '已锁定镜头' : '锁定镜头'}</button></div><p className="source-evidence"><Badge>{evidenceNames[selectedClip.evidence.type]}</Badge><span>{assets.find(a => a.id === selectedClip.asset_id)?.name} · {time(selectedClip.start_ms)} – {time(selectedClip.end_ms)}</span></p><p>{selectedClip.evidence.description}</p>{selectedClip.caption && <p className="caption-preview">字幕：{selectedClip.caption}</p>}<ClipIntent task={task} clip={selectedClip} /><div className="inspector-footer"><span>成片位置 {time(clipStart)}</span><button className="text-button small" onClick={() => setSourceAssetId(selectedClip.asset_id)}><Play size={12} />查看源素材</button></div></div>}{showEvidence && !selectedClip && <p className="timeline-hint">点击镜头查看源素材时间码、决策依据，或锁定该镜头。</p>}</> : <div className="timeline-empty"><div className="empty-track"><span /><span /><span /><span /></div><p>你的故事，会在这里串联起来</p><small>生成方案后，即可查看视频片段</small></div>}</div>}

            <div className="material-strip"><div className="panel-heading"><div><FolderOpen size={16} />{task ? '项目素材' : '素材库'}<span className="count-label">{taskAssets.length}</span></div><button className="text-button small" onClick={() => setView('assets')}>管理素材<ArrowRight size={13} /></button></div>{taskAssets.length ? <div className="strip-assets">{taskAssets.map(asset => <button className={`strip-asset ${sourceAssetId === asset.id ? 'selected' : ''}`} key={asset.id} onClick={() => setSourceAssetId(asset.id)}><div className="asset-thumb"><img src={asset.thumbnail_url} alt="" /><span>{time(asset.duration_ms)}</span></div><strong>{asset.name}</strong><small>{asset.width} × {asset.height} · {asset.shots.length} 段注释</small></button>)}</div> : <button className="material-drop" disabled={!!busy||preparing} onClick={() => inputRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files); }}><Upload size={19} /><span>{busy === 'upload' ? '正在读取素材…' : '拖入视频素材，或点击上传'}<small>素材元数据与时间码将自动读取</small></span><Plus size={17} /></button>}</div>
          </section>

          <aside className="agent-panel"><div className="agent-header"><span className="agent-avatar"><Sparkles size={19} /></span><div><strong>剪辑 Agent</strong><small>从想法到成片</small></div><button className="icon-button" aria-label="配置剪辑 Agent" onClick={openSettings}><Settings2 size={16} /></button></div><div className="agent-tabs"><button className={rightTab === 'agent' ? 'active' : ''} onClick={() => setRightTab('agent')}><WandSparkles size={14} />剪辑助手</button><button className={rightTab === 'brief' ? 'active' : ''} onClick={() => setRightTab('brief')}><FileJson size={14} />视频需求</button></div><div ref={agentBodyRef} className="agent-body">
            {rightTab === 'brief' ? task ? <BriefDetails brief={task.brief} /> : <div className="brief-empty"><PencilLine size={25} /><h3>好作品，从清晰的想法开始</h3><p>告诉 Agent 你想表达什么、给谁看，以及发布在哪里。</p><button className="button primary" disabled={!!busy} onClick={() => { startProject(); }}><Plus size={15} />填写需求</button></div> : !task ? <><div className="agent-welcome"><span className="greeting-label">LET'S MAKE SOMETHING GOOD</span><h2>创意由你，<br />剪辑交给我。<span>✦</span></h2><p>我会理解你的创作目标，整理素材，规划镜头，并把每一次修改变成可审阅的方案。</p></div><div className="how-it-works"><div><span>01</span><div><strong>给我素材和想法</strong><p>产品混剪、口播、精彩片段…</p></div></div><div><span>02</span><div><strong>一起确认剪辑方案</strong><p>镜头顺序、时长、字幕，清晰可见</p></div></div><div><span>03</span><div><strong>预览、调整，然后交付</strong><p>保留喜欢的镜头，定向修改其他部分</p></div></div></div><button className="start-brief" onClick={() => { startProject(); }}><span><PencilLine size={17} /><strong>开始我的第一个项目</strong></span><ArrowRight size={16} /></button><div className="mode-explainer"><ShieldCheck size={17} /><p>{settings?.model_configured ? '当前已配置模型。生成的方案仍需你的审阅与确认。' : '当前使用可解释的规则规划。连接模型后可启用语义规划和素材视觉分析。'}<button className="text-button small" onClick={openSettings}>查看能力与设置<ArrowRight size={12} /></button></p></div></> : <>
              {task.preparation?task.preparation.messages.filter((m,i,all)=>!!task.edl||m.role==='user'||i!==all.length-1).map(message=><div key={message.id} className={message.role==='user'?'conversation-user':'conversation-reply'}><small>{message.role==='user'?'你':'Agent'}</small><p>{message.text}</p></div>):<div className="conversation-user"><small>你</small><p>{task.brief.request}</p></div>}{task.events.filter(event=>event.type==='patch.proposed').map(event=><div className="conversation-exchange" key={event.id}><div className="conversation-user"><small>你</small><p>{String(event.data?.feedback||'')}</p></div><p className="conversation-reply"><Sparkles size={13}/>{event.message}</p></div>)}
              {task.pending_patch && <PatchPreviewCard patch={task.pending_patch} busy={!!busy} onAction={(action,payload)=>void taskAction(action,payload)} />}
              {task.state === 'DRAFT_BRIEF' && <PreparationCard task={task} assets={availableAssets} busy={!!busy} onRetry={()=>void taskAction('brief',{retry:true})} onUpload={()=>inputRef.current?.click()} onSelect={ids=>void taskAction('brief',{asset_ids:ids})}/>}
              {task.plan && <details className="agent-message plan-disclosure" open={task.state === 'WAITING_PLAN_APPROVAL' && !task.pending_patch}>
                <summary>剪辑方案{task.state === 'WAITING_PLAN_APPROVAL' ? ' · 待确认' : ' · 查看详情'}</summary><p>{task.plan.summary}</p>
                {task.plan?.skill?.status==='needs_material'&&<div className="skill-missing-notice"><strong>「{task.plan.skill.name}」还需要这些素材</strong><p>{task.plan.skill.details.join('、')}</p><button className="button compact" onClick={()=>setView('assets')}>去素材库补充注释</button><button className="button compact" disabled={!!busy} onClick={()=>void taskAction('plan')}>补充后重新生成方案</button></div>}
                {task.state === 'WAITING_PLAN_APPROVAL' && !task.pending_patch && <TextPlanDetails edl={task.edl!} assets={assets}/>}
                <details className="agent-details"><summary>查看剪辑说明<ChevronDown size={13}/></summary>{task.plan.recipe_match && <RecipeMatchView match={task.plan.recipe_match} compact/>}<div className="strategy-list">{task.plan.strategy.map((item,i)=><div key={i}><Check size={13}/><span>{item}</span></div>)}</div>{task.plan.assumptions.length>0 && <><strong>方案依据</strong><ul>{task.plan.assumptions.map((item,i)=><li key={i}>{item}</li>)}</ul></>}{task.plan.risks.length>0 && <><strong>需要留意</strong><ul>{task.plan.risks.map((item,i)=><li key={i}>{item}</li>)}</ul></>}{task.state==='WAITING_PLAN_APPROVAL' && !task.pending_patch && <button className="button full" disabled={!!busy || task.edl?.clips.some(c=>c.locked)} onClick={()=>void taskAction('plan',{})}>重新生成方案</button>}</details>
              </details>}

              {task.edl && <details className="review-disclosure"><summary>关键动作检查</summary><EditorialReviewCard task={task} /></details>}
              {task.qa && <details className="qa-card review-disclosure" open={!task.qa.passed}><summary>视频检查 · {task.qa.passed ? '通过' : '需要处理'}</summary><div className="message-label"><ShieldCheck size={15} />质量检查<Badge tone={task.qa.passed ? 'green' : 'red'}>{task.qa.passed ? '自动检查通过' : '存在待处理问题'}</Badge></div>{task.qa.checks.map((check, i) => <div className={`qa-check ${check.status}`} key={i}>{check.status === 'pass' ? <CircleCheck size={13} /> : <CircleHelp size={13} />}<div><strong>{check.name}</strong><small>{check.detail}</small></div>{check.status === 'manual' && <span>人工审阅</span>}</div>)}{task.qa.issues.map((issue, i) => <p className={`qa-issue ${issue.severity}`} key={i}>{issue.message}<small>{issue.evidence}</small></p>)}<p className="qa-footnote">请观看视频，确认画面、动作和声音符合预期。</p></details>}
              {task.state !== 'DELIVERED' && currentArtifacts.length > 0 && <details className="agent-details"><summary>当前版本文件<ChevronDown size={13} /></summary><div className="artifact-links">{currentArtifacts.map(artifact => <a key={`${artifact.kind}-${artifact.version}`} href={artifact.url} download><span><FileJson size={14} />{artifactNames[artifact.kind]}</span><ArrowDownToLine size={14} /></a>)}</div></details>}
              {task.state === 'WAITING_USER_REVIEW' && !task.pending_patch && <div className="approval-card"><strong>这一版，你满意吗？</strong><p>审阅预览后，可以继续提出修改，或确认并导出高清成片。</p><button className="button primary full" disabled={!!busy || !task.qa?.passed || !preview} onClick={() => void taskAction('approve-preview', { version: task.edl!.version })}><ArrowDownToLine size={15} />确认并导出视频</button></div>}
              {task.state === 'DELIVERED' && <div className="delivery-card"><div className="message-label"><CircleCheck size={16} />作品已就绪</div><p>当前版本的成片与编辑记录已保存。</p><div className="artifact-links">{currentArtifacts.filter(a => a.kind !== 'preview').map(artifact => <a key={`${artifact.kind}-${artifact.version}`} href={artifact.url} download><span><FileJson size={14} />{artifactNames[artifact.kind]}</span><ArrowDownToLine size={14} /></a>)}<a href={`/api/tasks/${task.id}/trace`} download><span><Layers3 size={14} />完整制作记录</span><ArrowDownToLine size={14} /></a></div></div>}
              {task.error && <div className="failure-card"><strong>{task.error.message}</strong><small>{task.error.code} · {task.error.stage}</small>{task.error.retryable && <button className="button full" disabled={!!busy || active || !!task.pending_patch} onClick={() => void taskAction('retry')}><RefreshCw size={14} />重试渲染</button>}</div>}
              {fullActive && <div className="agent-processing"><LoaderCircle size={15} className="spin" /><span>{stateNames[task.state]}</span><button className="text-button small" disabled={!!busy} onClick={() => void taskAction('cancel')}>取消运行</button></div>}
              {task.state === 'CANCELLED' && <div className="agent-message"><p>运行已取消。可以继续渲染当前方案，也可以创建新项目。</p><button className="button full" disabled={!!busy || !!task.pending_patch} onClick={() => void taskAction('retry')}><RefreshCw size={14} />继续渲染</button></div>}
            </>}
          </div>
          {task && <PlanApprovalAction task={task} busy={busy} onConfirm={() => {
            if (task.state !== 'WAITING_PLAN_APPROVAL' || !task.plan || !task.edl) return;
            void taskAction('approve-plan', { version: task.edl.version, candidate_digest: task.plan.text_review?.candidate_digest });
          }} />}
          <div className="agent-composer"><label className="text-plan-switch"><span><strong>先确认文字方案</strong></span><input type="checkbox" role="switch" aria-label="先确认文字方案" checked={settings?.confirm_text_plan??true} disabled={!settings||!!busy||active} onChange={e=>{const enabled=e.target.checked;void run('text-plan-setting',async()=>{setSettings(await post<Settings>('/settings',{confirm_text_plan:enabled}));});}} /></label><form onSubmit={e => { e.preventDefault(); if (feedback.trim()&&task) void taskAction(task.edl?'revise':'brief', task.edl?{ feedback: feedback.trim(), base_version: task.edl.version, ...(revisionClip ? {clip_ids:[revisionClip]} : {}) }:{message:feedback.trim()}).then(ok => { if (ok) setFeedback(''); }); }}>{task?.edl && <label className="revision-scope-select">修改范围<select aria-label="修改范围" value={revisionClip} onChange={e=>setRevisionClip(e.target.value)} disabled={active||!!busy}><option value="">根据建议自动定位</option>{task.edl.clips.map((c,i)=><option key={c.id} value={c.id}>镜头 {i+1} · {c.purpose}</option>)}</select></label>}<textarea value={feedback} onChange={e => setFeedback(e.target.value)} aria-label={task?.edl?'描述剪辑修改':'补充创作需求'} placeholder={task?.edl ? '例如：最后喝咖啡的动作再多留一会儿' : '告诉我更多想法，或补充要查找的画面…'} disabled={!task || !!busy} maxLength={4000} rows={2} /><div><span><MessageSquare size={12} />{task?.edl ? settings?.confirm_text_plan===false?'先看片段，确认后再改全片':'文字方案 → 片段预览 → 应用全片' : '你的创意，始终由你掌控'}</span><button className="send-button" aria-label={!task?.edl?"发送补充需求":settings?.confirm_text_plan===false?"生成片段预览":"生成文字修改方案"} disabled={!task || !feedback.trim() || active || !!busy} type="submit">{busy === 'revise'||busy==='brief' ? <LoaderCircle className="spin" size={16} /> : <ArrowUp size={17} />}</button></div></form></div></aside>
        </div>
      </>}
      </>}
    </main>
    {modal==='delete'&&deletion&&<Modal title={`删除${deletion.kind==='tasks'?'项目':deletion.kind==='assets'?'素材':'配乐'}`} onClose={()=>{if(!busy)setModal(null);}}><div className="delete-confirm"><span className="delete-confirm-icon"><Trash2 size={24}/></span><h3>{deletion.name}</h3><p>删除后可在「最近删除」中恢复。</p><small>{deletion.kind==='tasks'?'项目及其版本会一并移入最近删除，素材库中的原素材保留。':deletion.kind==='assets'?'从素材库移除，已有项目仍可使用这份素材。':music?.default_bgm_id===deletion.id?'默认配乐将切换为 Carefree，已有项目的配乐不变。':'从配乐库移除，已有项目的配乐不变。'}</small>{error&&<p className="settings-error" role="alert">{error}</p>}</div><div className="settings-footer"><span/><div><button className="button" disabled={!!busy} onClick={()=>setModal(null)}>取消</button><button className="button danger" disabled={!!busy} onClick={()=>void confirmDelete()}>{busy==='delete'?<LoaderCircle size={15} className="spin"/>:<Trash2 size={15}/>}确认删除</button></div></div></Modal>}
    {modal==='trash'&&<Modal title="最近删除" onClose={closeModal} wide><div className="trash-panel"><p>已删除的内容保留在这里，可随时恢复。</p><div className="trash-filters" role="group" aria-label="删除内容类型">{([['all','全部'],['tasks','项目'],['assets','素材'],['music','配乐']] as const).map(([id,label])=><button type="button" key={id} className={trashFilter===id?'selected':''} aria-pressed={trashFilter===id} onClick={()=>setTrashFilter(id)}>{label}</button>)}</div>{error&&<p className="settings-error" role="alert">{error}</p>}<div className="trash-list">{trash.filter(item=>trashFilter==='all'||item.kind===trashFilter).map(item=><div key={`${item.kind}-${item.id}`}><span className="trash-item-icon">{item.kind==='tasks'?<Clapperboard size={18}/>:item.kind==='assets'?<Film size={18}/>:<AudioLines size={18}/>}</span><span className="trash-item-name"><strong>{item.name}</strong><small>{item.kind==='tasks'?'项目':item.kind==='assets'?'素材':'配乐'} · {shortDate(item.deleted_at)}</small></span><button type="button" className="button compact" disabled={!!busy} aria-label={`恢复 ${item.name}`} onClick={()=>void run('restore',async()=>{await post(`/trash/${item.kind}/${item.id}/restore`);},'已恢复')}><RotateCcw size={14}/>恢复</button></div>)}</div>{!trash.some(item=>trashFilter==='all'||item.kind===trashFilter)&&<div className="trash-empty"><Trash2 size={27}/><span>暂无已删除内容</span></div>}</div></Modal>}
    {modal==='project-music'&&task&&<Modal title="配置视频配乐" onClose={closeModal}><ProjectMusic library={music} initial={task.edl?.bgm?{mode:'track',track_id:task.edl.bgm.track_id,gain:task.edl.bgm.gain,start_ms:task.edl.bgm.start_ms,ducking:task.edl.bgm.ducking}:task.brief.bgm} busy={!!busy} onSave={value=>void (async()=>{const ok=await taskAction('bgm',{version:task.edl?.version||0,bgm:value});if(ok){setModal(null);setRightTab('agent');}})()}/></Modal>}
    {modal === 'settings' && <SettingsModal error={error} library={music} settings={settings} busy={busy} onClose={closeModal} onSave={values => void run('settings', async () => { setSettings(await post<Settings>('/settings', values)); setModal(null); }, '配置已更新')} />}
    {modal === 'versions' && task && <Modal title="版本记录" onClose={closeModal}><p className="modal-intro">回退会复制历史方案为新版本，并重新生成预览。已有版本仍会保留。</p><div className="versions-list">{[...task.versions].reverse().map(version => <div className="version-row" key={version.version}><span className="version-icon"><Layers3 size={17} /></span><div><strong>版本 {version.version}{version.version === task.edl?.version && <Badge tone="green">当前版本</Badge>}</strong><p>{version.reason}</p><small>{shortDate(version.created_at)} · {version.edl.clips.length} 个镜头 · {time(durationOf(version.edl))}</small></div><button className="button compact" disabled={!!busy || active || !!task.pending_patch || version.version === task.edl?.version} onClick={() => void run('rollback', async () => { await post(`/tasks/${task.id}/rollback`, { version: version.version }); setModal(null); }, '已恢复历史方案为新版本，正在生成预览')}><RefreshCw size={12} />恢复</button></div>)}</div></Modal>}
    {previewAsset && <Modal title={previewAsset.name} onClose={() => setPreviewAsset(undefined)} wide><video className="asset-modal-video" src={previewAsset.url} poster={previewAsset.thumbnail_url} controls playsInline/></Modal>}
    {editingAsset && <AnnotationsModal asset={editingAsset} busy={busy} onClose={closeAnnotations} onSave={shots => void run('shots', async () => { await api(`/assets/${editingAsset.id}/shots`, { method: 'PUT', body: JSON.stringify({ shots }) }); setEditingAsset(undefined); }, '时间码注释已保存；新生成的方案会使用这些证据')} />}
  </div>;
}

function SimpleEmpty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) { return <div className="simple-empty"><span>{icon}</span><h2>{title}</h2><p>{text}</p></div>; }

function AssetGrid({ assets, busy, onPreview, onEdit, onAnalyze, modelConfigured, onDelete }: { assets: Asset[]; busy: string; onPreview: (a: Asset) => void; onEdit: (a: Asset) => void; onAnalyze: (a: Asset) => void; modelConfigured: boolean; onDelete:(asset:Asset)=>void }) {
  return assets.length ? <div className="asset-grid">{assets.map(asset => <article className="asset-card" key={asset.id}><button className="asset-card-preview" onClick={() => onPreview(asset)} aria-label={`预览 ${asset.name}`}><img src={asset.thumbnail_url} alt={`${asset.name} 缩略图`} /><span className="asset-play"><Play size={20} fill="currentColor" /></span><span className="duration-badge">{time(asset.duration_ms)}</span></button><div className="asset-card-info"><button type="button" className="asset-delete icon-button danger-text" disabled={!!busy} title="删除素材" aria-label={`删除素材 ${asset.name}`} onClick={()=>onDelete(asset)}><Trash2 size={15}/></button><h3 title={asset.name}>{asset.name}</h3><p>{asset.width} × {asset.height} · {asset.fps.toFixed(1)} FPS · {asset.has_audio ? '含音轨' : '无音轨'}</p><div className="asset-evidence"><Badge>{asset.shots.length} 段素材注释</Badge>{asset.shots.some(s => s.evidence.type === 'model_vision') && <Badge tone="green">已分析</Badge>}</div>{asset.warnings.map((w, i) => <p className="asset-warning" key={i}>{w}</p>)}<div className="asset-actions"><button className="button compact" disabled={!!busy} onClick={() => onEdit(asset)}><PencilLine size={13} />编辑注释</button><button className="button compact" disabled={!!busy || !modelConfigured} title={modelConfigured ? '将有序采样帧发送至已配置模型，返回待核对建议' : '请先在设置中连接模型'} onClick={() => onAnalyze(asset)}>{busy === `analyze-${asset.id}` ? <LoaderCircle size={13} className="spin" /> : <ScanEye size={13} />}分析关键动作</button></div></div></article>)}</div> : <SimpleEmpty icon={<FolderOpen size={34} />} title="灵感，从第一段素材开始" text="导入视频后，你可以在这里预览、添加时间码注释和触发模型分析。" />;
}

function BriefDetails({ brief }: { brief: Brief }) {
  const rows = [['剪辑技能',brief.skill_id?skillName(brief.skill_id):recipeName(brief.recipe)], ['剪辑场景', scenarioNames[brief.scenario]], ['发布平台', brief.platform], ['目标时长', `${brief.duration_ms / 1000} 秒`], ['画幅 / 分辨率', `${brief.aspect_ratio} / ${brief.resolution}`], ['产品 / 主题', brief.product || '未指定'], ['目标受众', brief.audience || '未指定'], ['风格', brief.style], ['画面文字', !brief.subtitles ? '文案字幕已关闭' : brief.allow_text_overlays ? '字幕与已启用的结尾文案' : '仅字幕'], ['结尾文案', brief.subtitles && brief.allow_text_overlays ? brief.cta || '未设置' : '不叠加'], ['字幕', brief.subtitles ? '开启' : '关闭']];
  return <div className="brief-details"><span className="eyebrow">CREATIVE BRIEF</span><h3>这支视频的创作方向</h3><p className="brief-request">{brief.request}</p><dl>{rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><p className="brief-note">可在剪辑助手中提出修改。所有改变会先生成待审方案。</p></div>;
}

function SettingsModal({ library, settings, busy, error, onClose, onSave }: { library?:MusicLibrary; settings?: Settings; busy: string; error:string; onClose: () => void; onSave: (values: Record<string, string|boolean>) => void }) {
  return <Modal title="设置" onClose={onClose} wide><SettingsForm library={library} settings={settings} busy={busy} error={error} onClose={onClose} onSave={onSave}/></Modal>;
}

function IntentEditor({shot,currentMs,onChange}:{shot:Shot;currentMs:number;onChange:(shot:Partial<Shot>)=>void}) {
  const intent=shot.intent;
  const [observations,setObservations]=useState(intent?.evidence.observed_at_ms.map(n=>(n/1000).toString()).join('，')||'');
  const patch=(value:Partial<NonNullable<Shot['intent']>>)=>{if(intent)onChange({intent:{...intent,...value}});};
  function capture(key:'action_start_ms'|'action_end_ms') {
    if(!intent)return;
    const observed=[...new Set([...intent.evidence.observed_at_ms,currentMs])].sort((a,b)=>a-b);
    setObservations(observed.map(n=>(n/1000).toFixed(3)).join('，'));
    patch({[key]:currentMs,evidence:{...intent.evidence,observed_at_ms:observed}});
  }
  return <section className="intent-editor"><label className="checkbox-label"><input type="checkbox" checked={!!intent} onChange={e=>onChange({intent:e.target.checked?{message:'',key_action:'',action_start_ms:shot.start_ms,action_end_ms:shot.end_ms,pre_roll_ms:0,post_roll_ms:0,priority:3,required:true,evidence:{description:'',observed_at_ms:[]}}:undefined})} />保护这个镜头的关键动作</label>
    {!intent?<p className="field-help">未标注时只生成待审阅草稿，无法判断是否剪掉核心内容。</p>:<>
      <p className="field-help">观看完整动作后，标记观众必须看到的内容。一张缩略图无法证明动作已完成。</p>
      <label>希望观众理解什么<input required maxLength={500} value={intent.message} onChange={e=>patch({message:e.target.value})} placeholder="例如：人物喝下咖啡，享受片刻休息" /></label>
      <label>必须保留的关键动作<input required maxLength={300} value={intent.key_action} onChange={e=>patch({key_action:e.target.value})} placeholder="例如：杯口触唇、饮用并放下杯子" /></label>
      <div className="form-grid">{(['action_start_ms','action_end_ms'] as const).map((key,j)=><label key={key}>{j?'动作完成（源片秒）':'动作开始（源片秒）'}<input type="number" required min={shot.start_ms/1000} max={shot.end_ms/1000} step="0.001" value={intent[key]/1000} onChange={e=>patch({[key]:Math.round(Number(e.target.value)*1000)})} /><button type="button" className="text-button small" onClick={()=>capture(key)}>使用播放位置 {time(currentMs)}</button></label>)}</div>
      <div className="form-grid"><label>动作前铺垫（秒）<input type="number" min={0} max={10} step="0.1" value={intent.pre_roll_ms/1000} onChange={e=>patch({pre_roll_ms:Math.round(Number(e.target.value)*1000)})} /></label><label>完成后停留（秒）<input type="number" min={0} max={10} step="0.1" value={intent.post_roll_ms/1000} onChange={e=>patch({post_roll_ms:Math.round(Number(e.target.value)*1000)})} /></label></div>
      <div className="form-grid"><label>信息优先级<select value={intent.priority} onChange={e=>patch({priority:Number(e.target.value)})}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n} · {n===5?'核心表达':n===1?'辅助铺垫':'内容展开'}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" checked={intent.required} onChange={e=>patch({required:e.target.checked})} />该动作必须出现在成片中</label></div>
      <label>动作观察依据<textarea required rows={2} maxLength={1500} value={intent.evidence.description} onChange={e=>patch({evidence:{...intent.evidence,description:e.target.value}})} placeholder="记录不同时间点看到了什么，尤其是动作结果与反应" /></label>
      <label>已核对的源片时间点（秒，用逗号分隔）<input required value={observations} onChange={e=>{setObservations(e.target.value);const values=e.target.value.split(/[,，\s]+/).filter(Boolean).map(n=>Math.round(Number(n)*1000));patch({evidence:{...intent.evidence,observed_at_ms:values}});}} placeholder="例如：5.5，7.5，10.5，12" /></label>
      <p className="field-help">至少两个不同时间点，覆盖动作起点和终点。保护区间：{time(intent.action_start_ms-intent.pre_roll_ms)}–{time(intent.action_end_ms+intent.post_roll_ms)}。</p>
    </>}
  </section>;
}
function AnnotationsModal({ asset, busy, onClose, onSave }: { asset: Asset; busy: string; onClose: () => void; onSave: (shots: Shot[]) => void }) {
  const [shots, setShots] = useState<Shot[]>(structuredClone(asset.shots));
  const [localError, setLocalError] = useState('');
  const [currentMs,setCurrentMs]=useState(0);
  const update = (idx: number, patch: Partial<Shot>) => setShots(current => current.map((shot, i) => i === idx ? { ...shot, ...patch } : shot));
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!shots.length || shots.some(s => !s.summary.trim() || s.start_ms < 0 || s.end_ms <= s.start_ms || s.end_ms > asset.duration_ms)) { setLocalError('每段注释都需要摘要，且时间范围须在素材内、结束时间大于开始时间。'); return; }
    for(const s of shots){const i=s.intent;if(!i)continue;
      if(!i.message.trim()||!i.key_action.trim()||!i.evidence.description.trim()||i.action_end_ms<=i.action_start_ms||i.action_start_ms-i.pre_roll_ms<s.start_ms||i.action_end_ms+i.post_roll_ms>s.end_ms){setLocalError('请填写镜头核心信息和动作依据；动作、铺垫与收尾必须位于该片段范围内。');return;}
      const times=i.evidence.observed_at_ms;if(new Set(times).size<2||times.some(t=>!Number.isFinite(t)||t<s.start_ms||t>s.end_ms)||Math.min(...times)>i.action_start_ms||Math.max(...times)<i.action_end_ms){setLocalError('至少记录两个不同的观察时间点，并覆盖动作开始和完成。');return;}
    }
    onSave(shots.map(s => ({ ...s, evidence: { type: 'user_annotation', confidence: 1, description: `用户标注：${s.summary}` } })));
  }
  return <Modal title="素材时间码与关键动作" onClose={onClose} wide><form className="annotations-form" onSubmit={submit}><p className="modal-intro">{asset.name} · {time(asset.duration_ms)}<br />先确认镜头要表达的信息，再标注必须完整保留的动作区间。模型生成的建议必须观看原片核对后保存。</p><video controls src={asset.url} className="annotation-video" aria-label="注释素材预览" onTimeUpdate={e=>setCurrentMs(Math.round(e.currentTarget.currentTime*1000))} />{localError && <div className="alert error" role="alert">{localError}</div>}<div className="shot-edit-list">{shots.map((shot, i) => <div className="shot-edit" key={shot.id}><div className="shot-edit-heading"><strong>片段 {i + 1}</strong><button className="icon-button" type="button" aria-label={`删除片段 ${i + 1}`} onClick={() => setShots(current => current.filter(s => s.id !== shot.id))}><X size={15} /></button></div><div className="form-grid"><label>开始（秒）<input type="number" required min={0} max={asset.duration_ms / 1000} step="0.001" value={shot.start_ms / 1000} onChange={e => update(i, { start_ms: Math.round(Number(e.target.value) * 1000) })} /></label><label>结束（秒）<input type="number" required min={0} max={asset.duration_ms / 1000} step="0.001" value={shot.end_ms / 1000} onChange={e => update(i, { end_ms: Math.round(Number(e.target.value) * 1000) })} /></label></div><label>画面摘要<textarea required rows={2} value={shot.summary} onChange={e => update(i, { summary: e.target.value })} maxLength={2000} /></label><label>逐字稿 / 已确认字幕（可选，最多 180 字）<textarea rows={2} value={shot.transcript || ''} onChange={e => update(i, { transcript: e.target.value })} maxLength={180} /></label><AdRoleEditor shot={shot} onChange={patch=>update(i,patch)} /><IntentEditor shot={shot} currentMs={currentMs} onChange={patch=>update(i,patch)} /></div>)}</div><button className="button" type="button" onClick={() => setShots(current => [...current, { id: `shot-${crypto.randomUUID()}`, asset_id: asset.id, start_ms: 0, end_ms: asset.duration_ms, summary: '', evidence: { type: 'user_annotation', confidence: 1, description: '' } }])}><Plus size={15} />添加时间段</button><div className="modal-footer"><span>保存后新建方案才会使用新标注，已有版本保持不变</span><button className="button primary" type="submit" disabled={!!busy}><Check size={15} />保存注释</button></div></form></Modal>;
}
