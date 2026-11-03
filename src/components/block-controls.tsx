'use client';
import { presetLabels,selectedPreset,groupBasePreset,presets,type StyleField } from '@/lib/styles';
import { LanguageSelect } from './code-language-select';
import {SlidersHorizontal} from 'lucide-react';
import {AutoGrowTextarea} from './auto-grow-textarea';

export const blockNames:Record<string,string>={group:'内容组',details:'折叠',tabs:'标签页',tab:'标签',columns:'分栏',column:'列',gallery:'图库',figure:'图片说明',image:'图片',code:'代码',math:'公式',inline_math:'行内公式',table:'表格',html:'自定义 HTML',raw_block:'源码区块'};
interface Block {name:string;attrs:Record<string,string>;tab?:{index:number;count:number}}
export function BlockControls({block,blockKey,source=false,update,format}:{block:Block;blockKey:string;source?:boolean;update:(key:string,value:string)=>void;format:(name:string,value?:string)=>void}){
  const {name,attrs}=block;
  const defaults:Partial<Record<StyleField,string>>=name==='group'?presets[groupBasePreset(attrs)]:{};
  const field=(key:string,label:string,placeholder='')=><label key={key}>{label}<input key={`${blockKey}-${key}`} aria-label={label} defaultValue={attrs[key]||''} placeholder={placeholder} onChange={event=>{if(['alt','src','title','href'].includes(key))update(key,event.target.value);}} onBlur={e=>{if(e.target.value!==(attrs[key]||''))update(key,e.target.value);}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/></label>;
  if(name==='code')return <>
    {source&&<label>语言<LanguageSelect value={attrs.language||'text'} onChange={value=>update('language',value)}/></label>}
    <label className="inline-check"><input type="checkbox" checked={attrs.lineNumbers!=='false'} onChange={e=>update('lineNumbers',String(e.target.checked))}/>行号</label>
    <details className="block-more"><summary>更多设置</summary><div className="block-more-content">
      <label>起始行号<input key={`${blockKey}-start-${attrs.start}`} aria-label="起始行号" type="number" min="1" defaultValue={attrs.start||'1'} onBlur={e=>update('start',String(Math.max(1,Number(e.target.value)||1)))}/></label>
      {field('highlight','高亮行','25-27,30')}{field('blur','模糊行','25-27,30')}
      <p className="small muted">按显示行号填写。模糊仅影响阅读显示，复制包含完整代码。</p>
    </div></details>
  </>;
  if(name==='math'||name==='inline_math')return <label className="block-formula">LaTeX<AutoGrowTextarea aria-label="LaTeX 公式" value={attrs.value||''} onChange={e=>update('value',e.target.value)}/></label>;
  if(name==='html'||name==='raw_block')return <span className="small muted">{source?'直接在正文源码中编辑。':'在区块内编辑源码并预览效果。'}</span>;
  if(name==='table')return <div className="table-edit-actions">{[['addRow','添加行'],['addColumn','添加列'],['deleteRow','删除行'],['deleteColumn','删除列']].map(([action,label])=><button type="button" className="button secondary" key={action} onClick={()=>format(action)}>{label}</button>)}</div>;
  if(name==='image')return <><span className="small muted block-control-hint">点击图片下方编辑说明</span><details className="block-more"><summary>更多设置</summary><div className="block-more-content">{field('alt','替代文本')}{field('src','图片地址')}{field('title','图片标题')}</div></details></>;
  return <>
    {name==='group'&&<label>样式预设<select aria-label="样式预设" value={selectedPreset(attrs)} onChange={e=>update('preset',e.target.value)}>{Object.entries(presetLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}
    {name==='group'&&groupBasePreset(attrs)==='shortcut'&&field('href','卡片链接','/links 或 https://…')}
    {['details','tab'].includes(name)&&field('title',name==='tab'?'标签标题':'折叠标题')}
    {name==='details'&&<label className="inline-check"><input type="checkbox" checked={attrs.open==='true'} onChange={e=>update('open',String(e.target.checked))}/>默认展开</label>}
    <details className="block-more block-style-more"><summary><SlidersHorizontal size={14}/>样式与布局</summary><div className="block-more-content style-fields">
      {name==='group'&&<p className="small muted">{selectedPreset(attrs)==='custom'?'当前使用自定义样式。':'自定义值已保留，仅在选择“自定义”时生效。修改下方样式将自动启用。'}</p>}
      {name==='group'&&<label>布局<select aria-label="布局" value={attrs.layout||''} onChange={e=>update('layout',e.target.value)}><option value="">纵向</option><option value="row">横向</option><option value="grid">双列网格</option></select></label>}
      {field('background','背景',defaults.background)}{field('color','文字',defaults.color)}
      {([['borderColor','边框颜色'],['borderWidth','边框宽度'],['borderStyle','边框样式'],['radius','圆角'],['padding','内边距'],['margin','外边距'],['gap','间距'],['fontSize','字号'],['lineHeight','行高'],['textAlign','对齐']] as const).map(([key,label])=>field(key,label,defaults[key]))}
    </div></details>
  </>;
}
