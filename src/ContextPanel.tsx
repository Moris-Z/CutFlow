import {useEffect,useId,useLayoutEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';

/** Secondary creation controls stay in context and return focus to their trigger. */
export function ContextPanel({title,children,onClose,anchor,wide=false,columns=false}:{title:string;children:ReactNode;onClose:()=>void;anchor?:RefObject<HTMLElement|null>;wide?:boolean;columns?:boolean}){
 const panel=useRef<HTMLDivElement>(null),close=useRef(onClose),id=useId();close.current=onClose;
 const [position,setPosition]=useState({left:16,top:16,width:700,maxHeight:620});
 useLayoutEffect(()=>{
  const place=()=>{const w=Math.min(wide?900:680,window.innerWidth-32),h=Math.min(window.innerWidth<=750?window.innerHeight-32:wide?600:660,window.innerHeight-32),rect=anchor?.current?.getBoundingClientRect();const top=rect&&rect.top>340?Math.max(16,rect.top-h-12):Math.max(16,(window.innerHeight-h)/2);setPosition({left:Math.max(16,Math.min(rect?rect.right-w:(window.innerWidth-w)/2,window.innerWidth-w-16)),top,width:w,maxHeight:Math.min(h,window.innerHeight-top-16)});};
  place();window.addEventListener('resize',place);return()=>window.removeEventListener('resize',place);
 },[wide,anchor]);
 useEffect(()=>{
  const previous=anchor?.current||document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';(panel.current?.querySelector<HTMLElement>('input,textarea,[role=combobox]')||panel.current?.querySelector<HTMLElement>('button'))?.focus({preventScroll:true});
  const keyboard=(e:KeyboardEvent)=>{if(e.defaultPrevented)return;if(e.key==='Escape'){e.preventDefault();close.current();}if(e.key==='Tab'){const focusable=[...panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')||[]].filter(n=>n.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus({preventScroll:true});}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus({preventScroll:true});}}};
  document.addEventListener('keydown',keyboard);return()=>{document.removeEventListener('keydown',keyboard);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true});};
 },[]);
 return createPortal(<div className="context-panel-layer" onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={panel} className={`context-panel ${wide?'wide':''} ${columns?'column-panel':''}`} style={{...position,...(columns?{height:position.maxHeight}:{})}} role="dialog" aria-modal="true" aria-labelledby={id}><header className="context-panel-header"><h2 id={id}>{title}</h2><button className="icon-button" aria-label={`关闭${title}`} onClick={onClose}><X size={19}/></button></header><div className="context-panel-body">{children}</div></div></div>,document.body);
}
