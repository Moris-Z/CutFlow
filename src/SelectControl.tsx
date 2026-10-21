import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,ChevronDown} from 'lucide-react';

export interface SelectOption {value:string;label:string;description?:string}
export function SelectControl({label,value,options,onChange,disabled=false}:{label:string;value:string;options:SelectOption[];onChange:(value:string)=>void;disabled?:boolean}) {
  const id=useId(),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
  const [open,setOpen]=useState(false),[active,setActive]=useState(0);
  const [position,setPosition]=useState({left:0,top:0,width:0,maxHeight:280});
  const selected=options.find(option=>option.value===value);
  const search=useRef({text:'',at:0});
  function show(){if(disabled||!options.length)return;setActive(Math.max(0,options.findIndex(option=>option.value===value)));setOpen(true);}
  function choose(index:number){if(!options[index])return;onChange(options[index].value);setOpen(false);trigger.current?.focus();}
  useEffect(()=>{
    if(!open)return;
    const place=()=>{
      const rect=trigger.current?.getBoundingClientRect();if(!rect)return;
      const below=window.innerHeight-rect.bottom-16,above=rect.top-16;
      const flip=below<200&&above>below;
      const height=Math.min(280,Math.max(80,flip?above:below));
      const measured=menu.current?.scrollHeight||height;
      setPosition({left:Math.max(8,Math.min(rect.left,window.innerWidth-rect.width-8)),top:flip?rect.top-8-Math.min(height,measured):rect.bottom+8,width:Math.min(rect.width,window.innerWidth-16),maxHeight:height});
    };
    place();const frame=requestAnimationFrame(place);
    const outside=(e:PointerEvent)=>{if(!trigger.current?.contains(e.target as Node)&&!menu.current?.contains(e.target as Node))setOpen(false);};
    const scroll=(e:Event)=>{if(!menu.current?.contains(e.target as Node))place();};
    document.addEventListener('pointerdown',outside);window.addEventListener('resize',place);window.addEventListener('scroll',scroll,true);
    return()=>{cancelAnimationFrame(frame);document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',place);window.removeEventListener('scroll',scroll,true);};
  },[open,options.length]);
  useEffect(()=>{if(!open||!menu.current)return;const item=menu.current.querySelector<HTMLElement>(`[data-index="${active}"]`),box=menu.current;if(item){if(item.offsetTop<box.scrollTop)box.scrollTop=item.offsetTop;else if(item.offsetTop+item.offsetHeight>box.scrollTop+box.clientHeight)box.scrollTop=item.offsetTop+item.offsetHeight-box.clientHeight;}},[active,open]);
  useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
  return <div className="select-field"><span className="field-label" id={`${id}-label`}>{label}</span>
    <button ref={trigger} type="button" className={`select-trigger ${open?'is-open':''}`} disabled={disabled} role="combobox" aria-label={label} aria-expanded={open} aria-controls={open?`${id}-list`:undefined} aria-haspopup="listbox" aria-activedescendant={open?`${id}-${active}`:undefined} onClick={()=>open?setOpen(false):show()} onBlur={()=>setOpen(false)} onKeyDown={e=>{
      if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();setOpen(false);return;}
      if(e.key==='Tab'){setOpen(false);return;}
      if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
        e.preventDefault();if(!open){show();return;}
        setActive(current=>e.key==='Home'?0:e.key==='End'?options.length-1:(current+(e.key==='ArrowDown'?1:-1)+options.length)%options.length);return;
      }
      if(e.key==='Enter'||e.key===' '){e.preventDefault();if(open)choose(active);else show();return;}
      if(e.key.length===1&&!e.ctrlKey&&!e.metaKey){e.preventDefault();const now=Date.now();search.current={text:(now-search.current.at<700?search.current.text:'')+e.key.toLowerCase(),at:now};const index=options.findIndex(o=>o.label.toLowerCase().startsWith(search.current.text));if(!open)show();if(index>=0)setActive(index);}
    }}><span>{selected?.label||'请选择'}</span><ChevronDown size={16}/></button>
    {open&&createPortal(<div ref={menu} id={`${id}-list`} role="listbox" aria-label={label} className="select-menu" style={position} onMouseDown={e=>e.preventDefault()}>{options.map((option,index)=><div id={`${id}-${index}`} key={option.value} data-index={index} role="option" aria-selected={option.value===value} className={`select-option ${index===active?'highlighted':''} ${option.value===value?'chosen':''}`} onPointerMove={()=>setActive(index)} onClick={()=>choose(index)}><span><strong>{option.label}</strong>{option.description&&<small>{option.description}</small>}</span>{option.value===value&&<Check size={16}/>}</div>)}</div>,document.body)}
  </div>;
}
