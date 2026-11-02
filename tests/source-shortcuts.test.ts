import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,createRef,act} from 'react';
import {createTestEditor} from './helpers/visual-editor';
import {CodeEditor} from '../src/components/code-editor';
import type {EditorView as SourceView} from '@codemirror/view';

test('source inline shortcuts override diagnostics and undo never removes externally loaded prose',async()=>{
  const setup=await createTestEditor({views:true}),container=document.createElement('div');document.body.append(container);
  const {createRoot}=await import('react-dom/client'),globals=globalThis as any;
  const oldWindow=globals.Window,oldAct=globals.IS_REACT_ACT_ENVIRONMENT,oldObserver=globals.ResizeObserver;
  globals.Window=window.Window;globals.IS_REACT_ACT_ENVIRONMENT=true;
  class Observer {observe(){}unobserve(){}disconnect(){}}globals.ResizeObserver=Observer;(window as any).ResizeObserver=Observer;
  const root=createRoot(container),ref=createRef<SourceView|null>(),changes:string[]=[];
  const render=(value:string)=>root.render(createElement(CodeEditor,{value,onChange:next=>changes.push(next),onCursor:()=>{},onPaste:()=>{},editorRef:ref}));
  const press=(key:string,shiftKey=false)=>{ref.current!.contentDOM.dispatchEvent(new window.KeyboardEvent('keydown',{key,code:key.toLowerCase()==='m'?'KeyM':key.toLowerCase()==='e'?'KeyE':'KeyZ',ctrlKey:true,shiftKey,bubbles:true,cancelable:true}));};
  try{
    await act(async()=>render(''));
    const source='在**模型评估**中，公式 $x^2$。';await act(async()=>render(source));
    assert.deepEqual(changes,[]);ref.current!.focus();ref.current!.dispatch({selection:{anchor:0}});
    await act(async()=>press('M',true));assert.equal(ref.current!.state.doc.toString(),'$$'+source);assert.equal(container.querySelector('.cm-panel-lint'),null);
    await act(async()=>press('z'));assert.equal(ref.current!.state.doc.toString(),source);
    await act(async()=>press('e'));assert.equal(ref.current!.state.doc.toString(),'``'+source);
    await act(async()=>press('z'));assert.equal(ref.current!.state.doc.toString(),source);
    await act(async()=>press('z'));assert.equal(ref.current!.state.doc.toString(),source,'loading visual-mode changes must not become an undoable replacement');
  }finally{
    await act(async()=>root.unmount());container.remove();globals.Window=oldWindow;globals.IS_REACT_ACT_ENVIRONMENT=oldAct;globals.ResizeObserver=oldObserver;await setup.close();
  }
});
