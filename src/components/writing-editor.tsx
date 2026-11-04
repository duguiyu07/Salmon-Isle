"use client";
import {forwardRef,useEffect,useImperativeHandle,useLayoutEffect,useRef,useState} from 'react';
import type {Ref} from 'react';
import {createPortal} from 'react-dom';
import {EditorView,type ViewUpdate} from '@codemirror/view';
import {Layers,ArrowUp,ArrowDown,Plus,Bold,Italic,Strikethrough,List,ListOrdered,Link as LinkIcon,Undo2,Redo2,X,Trash2,ImagePlus,ChevronRight} from 'lucide-react';
import {styleFields,validStyle,updateGroupAttributes} from '@/lib/styles';
import {sourceBlockMove,blockAtLine} from '@/lib/editor-block';
import {serializeCodeMeta} from '@/lib/code-block';
import {codeLanguage} from '@/lib/code-languages';
import {linkedImageSourceMarkdown} from '@/lib/image-caption';
import type {DraftDocument} from '@/lib/editor-draft-model';
import type {EditorMode,EditorAnchor} from '@/lib/editor-ui';
import {VisualEditor,VisualEditorHandle,VisualBlock} from './visual-editor';
import {MarkdownBody} from './reader';
import {CodeEditor} from './code-editor';
import {BlockControls,blockNames} from './block-controls';
import {InsertionOptions} from './insertion-options';
import {ColorPicker} from './color-picker';
import {sourceColorEdits} from '@/lib/inline-color-edit';
import type {ColorField} from '@/lib/inline-color';

export type {EditorMode} from '@/lib/editor-ui';
export type WritingDocument=DraftDocument;
export interface WritingHandle {insert:(text:string)=>void;openBlockSettings:()=>void;closePanels:()=>void}
interface Props{
  doc:WritingDocument;dirty:boolean;mode:EditorMode;onModeChange:(mode:EditorMode)=>void;preview:string;
  onChange:(patch:Partial<WritingDocument>)=>void;onUpload:(file:File)=>void;onChooseMedia?:()=>void;onError:(message:string)=>void;onBlockAvailabilityChange:(available:boolean)=>void;
}
export function LazyWritingEditor({editorRef,...props}:Props&{editorRef:Ref<WritingHandle>}){return <WritingEditor ref={editorRef} {...props}/>;}
export const WritingEditor=forwardRef<WritingHandle,Props>(function WritingEditor({doc,mode,onModeChange,preview,onChange,onUpload,onChooseMedia,onError,onBlockAvailabilityChange},ref){
  const [docked,setDocked]=useState(false);const dock=useRef<HTMLDivElement>(null);
  const [cursor,setCursor]=useState(1),[block,setBlock]=useState<VisualBlock|null>(null),[settingsOpen,setSettingsOpen]=useState(false);
  const [blank,setBlank]=useState<EditorAnchor|null>(null),[insertAnchor,setInsertAnchor]=useState<EditorAnchor|null>(null),[position,setPosition]=useState<{top:number;left:number}|null>(null);
  const visual=useRef<VisualEditorHandle>(null),code=useRef<EditorView|null>(null),modeRef=useRef(mode);modeRef.current=mode;
  const editorArea=useRef<HTMLDivElement>(null);
  const floating=useRef<HTMLDivElement>(null),insertion=useRef<HTMLDivElement>(null),toolbar=useRef<HTMLDivElement>(null),linkDialog=useRef<HTMLDialogElement>(null);
  const codeBookmark=useRef<{from:number;to:number}|null>(null),openTarget=useRef(''),current=useRef({block,mode,settingsOpen,insertAnchor});current.current={block,mode,settingsOpen,insertAnchor};
  const sourceBlock=mode==='code'?blockAtLine(doc.body,cursor):null,selected=mode==='code'?sourceBlock:block;
  const blockKey=selected?`${selected.name}-${'position' in selected?selected.position:selected.index}`:'';
  const visible=settingsOpen&&!!selected&&selected.name!=='tab'&&mode!=='preview';
  const flush=()=>{const active=document.activeElement;if(active instanceof HTMLElement&&floating.current?.contains(active))active.blur();};
  function closePanels(){flush();setSettingsOpen(false);setInsertAnchor(null);}
  function rememberSelection(){
    if(mode==='code'&&code.current){const selection=code.current.state.selection.main;codeBookmark.current={from:selection.from,to:selection.to};}
    else visual.current?.rememberSelection();
  }
  function openBlockSettings(){
    if(!selected||selected.name==='tab'||mode==='preview')return;
    if(mode==='visual'&&block)visual.current?.selectBlock(block.position);
    openTarget.current=blockKey;setSettingsOpen(true);setInsertAnchor(null);
  }
  function insert(text:string){
    setInsertAnchor(null);
    if(mode==='code'&&code.current){
      const view=code.current,selection=codeBookmark.current||view.state.selection.main;codeBookmark.current=null;
      view.dispatch({changes:{from:selection.from,to:selection.to,insert:text},selection:{anchor:selection.from+text.length}});view.focus();
    }else{if(mode==='preview')onModeChange('visual');visual.current?.insert(text);}
  }
  function insertBlock(markdown:string){insert(mode==='code'?markdown+'\n\n':markdown);}
  useImperativeHandle(ref,()=>({insert,openBlockSettings,closePanels}));
  useEffect(()=>{onBlockAvailabilityChange(!!selected&&selected.name!=='tab'&&mode!=='preview');},[!!selected,selected?.name,mode,onBlockAvailabilityChange]);
  useEffect(()=>{setSettingsOpen(false);setInsertAnchor(null);setBlank(null);if(mode==='code')code.current?.requestMeasure();else if(mode==='visual')visual.current?.focus();},[mode]);
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{
      const target=event.target as Node;
      if(floating.current&&!floating.current.contains(target)){const active=document.activeElement;if(active instanceof HTMLElement&&floating.current.contains(active))active.blur();setSettingsOpen(false);}
      if(insertion.current&&!insertion.current.contains(target))setInsertAnchor(null);
    };
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||event.defaultPrevented||linkDialog.current?.open)return;
      if(current.current.settingsOpen||current.current.insertAnchor){event.preventDefault();const active=document.activeElement;if(active instanceof HTMLElement&&floating.current?.contains(active))active.blur();setSettingsOpen(false);setInsertAnchor(null);if(current.current.mode==='code')code.current?.focus();else visual.current?.focus();}
    };
    const scroll=(event:Event)=>{if(insertion.current&&!insertion.current.contains(event.target as Node))setInsertAnchor(null);};
    document.addEventListener('pointerdown',outside,true);window.addEventListener('keydown',escape);window.addEventListener('scroll',scroll,true);
    return()=>{document.removeEventListener('pointerdown',outside,true);window.removeEventListener('keydown',escape);window.removeEventListener('scroll',scroll,true);};
  },[]);
  useEffect(()=>setDocked(false),[blockKey,visible]);
  useLayoutEffect(()=>{
    if(!visible){setPosition(null);return;}
    const measure=()=>{
      const root=floating.current;if(!root)return;
      const coords=mode==='code'&&code.current?code.current.coordsAtPos(code.current.state.selection.main.head):null;
      const rect=mode==='code'&&coords?{top:coords.top,bottom:coords.bottom,left:code.current!.contentDOM.getBoundingClientRect().left,right:coords.right}:block?.rect;
      if(!rect){setPosition(null);return;}
      const minTop=Math.max(16,(toolbar.current?.getBoundingClientRect().bottom||0)+12);
      if(rect.bottom<minTop||rect.top>window.innerHeight-12){setPosition(null);return;}
      const more=Math.max(0,...Array.from(root.querySelectorAll<HTMLElement>('.block-more[open]>.block-more-content,.block-parent-menu[open]>div')).map(element=>element.offsetHeight+8));
      const bounds=editorArea.current?.getBoundingClientRect();const left=Math.max(12,bounds?.left||rect.left),right=Math.min(window.innerWidth-12,bounds?.right||window.innerWidth-12);root.style.width=Math.max(180,right-left)+'px';
      const height=root.offsetHeight+more,width=root.offsetWidth,above=rect.top-minTop-16,below=window.innerHeight-rect.bottom-28;
      if(!docked&&above<height&&below<height){setDocked(true);setPosition({top:0,left});return;}
      const top=above>=height||above>=below?Math.max(minTop,rect.top-height-16):Math.min(rect.bottom+16,window.innerHeight-height-12);
      root.style.setProperty('--block-menu-max-height',`${Math.max(100,Math.max(above,below)-root.offsetHeight-8)}px`);
      setPosition({top:Math.max(minTop,top),left});
    };
    measure();const observer=new ResizeObserver(measure),root=floating.current!;
    observer.observe(root);root.querySelectorAll('.block-more-content').forEach(element=>observer.observe(element));
    root.addEventListener('toggle',measure,true);window.addEventListener('resize',measure);window.addEventListener('scroll',measure,true);
    return()=>{observer.disconnect();root.removeEventListener('toggle',measure,true);window.removeEventListener('resize',measure);window.removeEventListener('scroll',measure,true);};
  },[visible,block,sourceBlock?.index,mode,docked]);
  function update(key:string,value:string){
    if(!selected)return;
    if(styleFields.includes(key as typeof styleFields[number])&&value&&!validStyle(key,value)){onError('样式值无效，请使用颜色值或 px / rem / em 等尺寸');return;}
    if(key==='language')value=codeLanguage(value);
    if(mode!=='code'){visual.current?.updateBlock({[key]:value});return;}
    if(!sourceBlock||!code.current||sourceBlock.name==='html')return;
    const attrs=sourceBlock.name==='group'?updateGroupAttributes(sourceBlock.attrs,{[key]:value}):{...sourceBlock.attrs,[key]:value};
    if(!value)delete attrs[key];
    const view=code.current;
    if(sourceBlock.name==='image'&&sourceBlock.from!==undefined){
      const figureAttributes=Object.fromEntries(styleFields.filter(field=>attrs[field]).map(field=>[field,attrs[field]]));
      view.dispatch({changes:{from:sourceBlock.from,to:sourceBlock.to,insert:linkedImageSourceMarkdown({src:attrs.src,alt:attrs.alt,title:attrs.title,caption:attrs.caption,figureAttributes},attrs.linkHref,attrs.linkTitle)}});
      return;
    }
    const replacement=sourceBlock.name==='code'?`${sourceBlock.fence}${attrs.language||'text'} ${serializeCodeMeta({lineNumbers:attrs.lineNumbers!=='false',start:Math.max(1,Number(attrs.start)||1),highlight:attrs.highlight||'',blur:attrs.blur||''})}`.trimEnd():`${sourceBlock.fence}${sourceBlock.name}{${Object.entries(attrs).map(([name,entry])=>`${name}=${JSON.stringify(entry)}`).join(' ')}}`;
    const line=view.state.doc.line(sourceBlock.index+1);view.dispatch({changes:{from:line.from,to:line.to,insert:replacement}});
  }
  const canMove=(direction:-1|1)=>mode==='code'?!!sourceBlock&&!!sourceBlockMove(doc.body,sourceBlock,direction):!!visual.current?.canMove(direction);
  const move=(direction:-1|1)=>{flush();if(mode==='code'&&code.current&&sourceBlock){const edit=sourceBlockMove(doc.body,sourceBlock,direction);if(edit){code.current.dispatch({changes:{from:edit.from,to:edit.to,insert:edit.insert},selection:{anchor:edit.anchor},scrollIntoView:true});code.current.focus();}}else visual.current?.moveBlock(direction);};
  const format=(name:string,value?:string)=>visual.current?.format(name,value);
  function applyColor(field:ColorField,value:string){
    if(mode==='visual'){format(field,value);return;}
    const view=code.current;if(!view)return;const selection=codeBookmark.current||view.state.selection.main;codeBookmark.current=null;
    const edits=sourceColorEdits(view.state.doc.toString(),selection.from,selection.to,field,value);if(!edits.length)return;
    const first=edits[0],last=edits.at(-1)!,delta=edits.slice(0,-1).reduce((sum,edit)=>sum+edit.insert.length-(edit.to-edit.from),0);
    view.dispatch({changes:edits.map(({from,to,insert})=>({from,to,insert})),selection:{anchor:first.anchor,head:last.head+delta},scrollIntoView:true});view.focus();
  }
  const keepSelection=(event:React.MouseEvent)=>{if((event.target as HTMLElement).closest('button')){flush();event.preventDefault();}};
  const anchor=insertAnchor||blank;
  const onRight=!!anchor&&(anchor.left<64||typeof window!=='undefined'&&window.innerWidth<=700);
  const anchorTop=anchor?(anchor.top+anchor.bottom)/2-14:0;
  const above=typeof window!=='undefined'&&anchorTop+290>window.innerHeight;
  const plusVisible=anchor&&mode!=='preview'&&anchorTop>Math.max(12,toolbar.current?.getBoundingClientRect().bottom||0)&&typeof window!=='undefined'&&anchorTop<window.innerHeight-28;
  return <>
    <input className="editor-title" placeholder="文章标题" aria-label="文章标题" value={doc.title} onChange={event=>onChange({title:event.target.value})}/>
    <div className={'editor-sticky-tools writing-toolbar mode-'+mode} ref={toolbar} role="toolbar" aria-label="写作工具" onMouseDown={keepSelection}>
      {mode!=='preview'&&<div className="writing-format-actions">
        {mode==='visual'&&<>
          <div className="writing-tool-group" role="group" aria-label="段落样式"><select aria-label="段落样式" defaultValue="0" onChange={event=>{format('heading',event.target.value);event.target.value='0';}}><option value="0">正文</option>{[1,2,3,4,5,6].map(level=><option key={level} value={level}>标题 {level}</option>)}</select></div>
          {([
            ['文字格式',[['strong','加粗',Bold],['emphasis','斜体',Italic],['strike_through','删除线',Strikethrough]]],
            ['列表',[['bullet','无序列表',List],['ordered','有序列表',ListOrdered]]],
            ['撤销／重做',[['undo','撤销',Undo2],['redo','重做',Redo2]]]
          ] as const).map(([group,items])=><div className="writing-tool-group" role="group" aria-label={group} key={group}>{items.map(([name,label,Icon])=><button key={name} type="button" title={label} aria-label={label} onClick={()=>format(name)}><Icon size={16}/></button>)}</div>)}
          <div className="writing-tool-group" role="group" aria-label="段落操作"><button type="button" aria-label="快捷组合" title="将完整段落加入内容组" onClick={()=>visual.current?.groupSelection()}><Layers size={16}/></button><button type="button" aria-label="上移当前段落" title="上移完整段落或列表项" onClick={()=>visual.current?.moveBlock(-1)}><ArrowUp size={16}/></button><button type="button" aria-label="下移当前段落" title="下移完整段落或列表项" onClick={()=>visual.current?.moveBlock(1)}><ArrowDown size={16}/></button><button type="button" aria-label="删除当前段落" title="删除完整段落或列表项（可撤销）" onClick={()=>visual.current?.deleteSelectionBlocks()}><Trash2 size={16}/></button></div>
        </>}
        <div className="writing-tool-group" role="group" aria-label="文字颜色与背景色">{(['color','background'] as const).map(field=><ColorPicker key={field} field={field} onRemember={rememberSelection} onApply={applyColor}/>)}</div>
        <div className="writing-tool-group" role="group" aria-label="插入">
          {mode==='visual'&&<button type="button" aria-label="插入链接" title="插入链接" onClick={()=>linkDialog.current?.showModal()}><LinkIcon size={16}/></button>}
          {onChooseMedia&&<button type="button" aria-label="插入图片" title="插入图片" onClick={()=>{rememberSelection();onChooseMedia();}}><ImagePlus size={16}/></button>}
        </div>
      </div>}
      <div className="writing-view-modes" role="group" aria-label="编辑模式">{([['visual','可视化'],['code','源码'],['preview','预览']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={mode===value} className={mode===value?'active':''} onClick={()=>onModeChange(value)}>{label}</button>)}</div>
    </div>
    <div ref={dock} className="editor-panel-dock" style={{top:(toolbar.current?.getBoundingClientRect().bottom||64)+8}}/><div className="editor-layout writing-layout"><div className="editor-text-area" ref={editorArea}>
      <div hidden={mode!=='visual'}><VisualEditor ref={visual} value={doc.body} onChange={body=>onChange({body})} onSelect={(value,open)=>{
        if(modeRef.current!=='visual')return;setBlock(value);
        const key=value?`${value.name}-${value.position}`:'';
        if(open&&value){openTarget.current=key;setSettingsOpen(true);setInsertAnchor(null);}
        else if(current.current.settingsOpen&&key!==openTarget.current)setSettingsOpen(false);
      }} onBlankLine={value=>{if(modeRef.current==='visual')setBlank(value);}} onPaste={onUpload}/></div>
      <div hidden={mode!=='code'} className="editor-panes"><CodeEditor value={doc.body} onChange={body=>onChange({body})} onCursor={setCursor} onPaste={file=>{rememberSelection();onUpload(file);}} editorRef={code} onBlankLine={value=>{if(modeRef.current==='code')setBlank(value);}} onUpdate={(update:ViewUpdate)=>{if(update.docChanged&&codeBookmark.current)codeBookmark.current={from:update.changes.mapPos(codeBookmark.current.from),to:update.changes.mapPos(codeBookmark.current.to)};}}/></div>
      {mode==='preview'&&<div className="editor-preview-only"><MarkdownBody html={preview}/></div>}
      <div className="editor-bottom"><span>Markdown</span><span>{doc.body.length.toLocaleString()} 字符</span></div>
    </div></div>
    {plusVisible&&createPortal(<div ref={insertion} className={`writing-inline-insert${onRight?' insert-on-right':''}${above?' insert-above':''}`} style={{top:anchorTop,left:onRight?Math.min(anchor!.right-28,window.innerWidth-40):anchor!.left-48}} onMouseDown={keepSelection} onKeyDown={event=>{
      if(!insertAnchor||!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();
      const items=Array.from(insertion.current!.querySelectorAll<HTMLElement>('[role=menuitem]')),index=items.indexOf(document.activeElement as HTMLElement);items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:items.length-1)+items.length)%items.length]?.focus();
    }}>
      <button type="button" className="writing-inline-plus" aria-label="插入区块" title="插入区块" aria-expanded={!!insertAnchor} onClick={event=>{flush();setSettingsOpen(false);rememberSelection();setInsertAnchor(value=>value?null:anchor);if(event.detail===0)requestAnimationFrame(()=>insertion.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus());}}><Plus size={19}/></button>
      {insertAnchor&&<InsertionOptions onInsert={insertBlock} onUploadStart={rememberSelection} onChooseMedia={onChooseMedia?()=>{setInsertAnchor(null);onChooseMedia();}:undefined} onUpload={file=>{setInsertAnchor(null);onUpload(file);}}/>}
    </div>,document.fullscreenElement||document.body)}
    {visible&&selected&&createPortal(<div ref={floating} className={'block-controls floating-block-controls'+(docked?' is-docked':'')} role="toolbar" aria-label="区块设置" style={position?{...position,visibility:'visible'}:{top:0,left:12,visibility:'hidden'}} onMouseDown={keepSelection}>
      {mode==='visual'&&block&&block.parents.length>0&&<details className="block-parent-menu"><summary title="选择父级区块" aria-label="选择父级区块"><ChevronRight size={14}/></summary><div>{block.parents.map(parent=><button type="button" key={parent.position} onClick={()=>{openTarget.current=`${parent.name}-${parent.position}`;visual.current?.selectBlock(parent.position);setSettingsOpen(true);}}>选择{blockNames[parent.name]||'父级区块'}</button>)}</div></details>}
      <BlockControls key={blockKey} block={selected} blockKey={blockKey} source={mode==='code'} update={update} format={format}/>
      <div className="block-control-actions">
        <button type="button" className="icon-button" aria-label="上移区块" title="上移区块" disabled={!canMove(-1)} onClick={()=>move(-1)}><ArrowUp size={16}/></button>
        <button type="button" className="icon-button" aria-label="下移区块" title="下移区块" disabled={!canMove(1)} onClick={()=>move(1)}><ArrowDown size={16}/></button>
        <button type="button" className="delete-block-button icon-button" title={`删除${blockNames[selected.name]||'区块'}（可撤销）`} aria-label={`删除${blockNames[selected.name]||'区块'}`} disabled={mode==='code'&&sourceBlock?.from===undefined} onClick={()=>{
          if(mode==='code'&&code.current&&sourceBlock?.from!==undefined)code.current.dispatch({changes:{from:sourceBlock.from,to:sourceBlock.to,insert:''}});
          else visual.current?.deleteBlock();setSettingsOpen(false);
        }}><Trash2 size={16}/></button>
        <button type="button" className="icon-button close-block-controls" aria-label="关闭区块设置" onClick={()=>{flush();setSettingsOpen(false);}}><X size={16}/></button>
      </div>
    </div>,docked&&dock.current?dock.current:document.fullscreenElement||document.body)}
    <dialog ref={linkDialog} className="link-dialog"><form onSubmit={event=>{event.preventDefault();format('link',String(new FormData(event.currentTarget).get('href')));linkDialog.current?.close();}}><label>链接地址<input name="href" placeholder="https://" required autoFocus/></label><div className="admin-actions"><button type="button" className="button secondary" onClick={()=>linkDialog.current?.close()}>取消</button><button className="button primary">插入链接</button></div></form></dialog>
  </>;
});
