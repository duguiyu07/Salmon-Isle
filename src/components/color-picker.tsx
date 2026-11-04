'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Baseline,Highlighter,X} from 'lucide-react';
import {colorLabels,textColors,highlightColors,inlineColorStyle,normalizeColor,type ColorField} from '@/lib/inline-color';

export function ColorPicker({field,onApply,onRemember,onOpenChange}:{field:ColorField;onApply:(field:ColorField,value:string)=>void;onRemember:()=>void;onOpenChange?:(open:boolean)=>void}){
  const [open,setOpen]=useState(false),[custom,setCustom]=useState('#3478ce'),[position,setPosition]=useState({top:0,left:0}),button=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),id=useId();
  const label=field==='color'?'文字颜色':'背景色',Icon=field==='color'?Baseline:Highlighter,presets=field==='color'?textColors:highlightColors;
  const close=()=>{setOpen(false);onOpenChange?.(false);};
  useEffect(()=>{if(!open)return;
    const measure=()=>{const rect=button.current?.getBoundingClientRect();if(rect)setPosition({left:Math.max(8,Math.min(rect.left,window.innerWidth-268)),top:rect.bottom+292>window.innerHeight?Math.max(8,rect.top-292):rect.bottom+6});};measure();
    const outside=(event:PointerEvent)=>{if(!panel.current?.contains(event.target as Node)&&!button.current?.contains(event.target as Node))close();};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close();button.current?.focus();}};
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',key);window.addEventListener('resize',measure);window.addEventListener('scroll',measure,true);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key);window.removeEventListener('resize',measure);window.removeEventListener('scroll',measure,true);};
  },[open]);
  function apply(value:string){onApply(field,value);close();}
  return <><button ref={button} type="button" aria-label={label} title={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>{if(open)close();else{onRemember();onOpenChange?.(true);setOpen(true);}}}><Icon size={16}/></button>{open&&createPortal(<div id={id} ref={panel} className="inline-color-picker" role="dialog" aria-label={label} style={position} onMouseDown={event=>event.stopPropagation()}>
    <div className="color-picker-heading"><strong>{label}</strong><button type="button" aria-label="关闭选色" onClick={close}><X size={16}/></button></div>
    <div className="color-swatches">{Object.keys(presets).map(value=><button key={value} type="button" aria-label={`${colorLabels[value]}色${label}`} title={`${colorLabels[value]}色`} onClick={()=>apply(value)}><span style={Object.fromEntries(inlineColorStyle({[field]:value}).split(';').map(pair=>{const [key,value]=pair.split(':');return [key==='background-color'?'backgroundColor':key,value];}))}>{field==='color'?'A':'荧'}</span></button>)}</div>
    <label className="custom-color-label">自定义颜色<div><input type="color" aria-label={`选择自定义${label}`} value={normalizeColor(custom,field)?.startsWith('#')?normalizeColor(custom,field):'#3478ce'} onChange={event=>setCustom(event.target.value)}/><input aria-label={`自定义${label} HEX`} value={custom} onChange={event=>setCustom(event.target.value)} maxLength={7}/><button type="button" className="button secondary" disabled={!normalizeColor(custom,field)} onClick={()=>apply(custom)}>应用</button></div></label>
    <p className="small muted">自动适配日间与深色模式</p><button type="button" className="text-button color-reset" onClick={()=>apply('')}>{field==='color'?'恢复默认文字颜色':'清除背景色'}</button>
  </div>,document.fullscreenElement||document.body)}</>;
}
