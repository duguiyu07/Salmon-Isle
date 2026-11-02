import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {EditorState,TextSelection} from '@milkdown/kit/prose/state';
import {DecorationSet} from '@milkdown/kit/prose/view';
import {history,undo,redo} from '@milkdown/kit/prose/history';
import {createTestEditor,equivalentVisualDocuments} from './helpers/visual-editor';
import {parseVisualMarkdown,serializeVisualMarkdown} from '../src/lib/visual-schema';
import {activateTab,deleteBlockTransaction,tabChildren,tabTransaction,visualTabsKey,visualTabsPlugin} from '../src/lib/visual-blocks';
import {blockStyle,groupClasses,selectedPreset,updateGroupAttributes} from '../src/lib/styles';
import {htmlBlockMarkdown} from '../src/lib/html-block';
import {renderMarkdown} from '../src/lib/markdown';
import {blockAtLine} from '../src/lib/editor-block';
import {editorInsertions} from '../src/lib/editor-insertions';
import {sourceBlockView} from '../src/components/visual-nodeviews';

test('custom styles are retained but inactive under other presets, including after reopening Markdown',async()=>{
  const legacy={preset:'green',padding:'8px',layout:'grid'};
  const original=blockStyle(legacy);assert.equal(selectedPreset(legacy),'custom');assert.match(original,/padding:8px/);
  const custom=updateGroupAttributes(legacy,{color:'#123456'});
  assert.equal(custom.preset,'custom');assert.equal(custom.customBase,'green');assert.equal(custom.styleVersion,'2');
  assert.match(blockStyle(custom),/padding:8px/);assert.match(blockStyle(custom),/background-color:#cee5bd/);
  const purple=updateGroupAttributes(custom,{preset:'purple'});
  assert.equal(selectedPreset(purple),'purple');assert.equal(purple.padding,'8px');assert.equal(purple.color,'#123456');
  assert.doesNotMatch(blockStyle(purple),/padding:8px|color:#123456|background-color:#cee5bd/);
  assert.match(blockStyle(purple),/background-color:#f5ccf35c/);
  const setup=await createTestEditor();try{
    const restored=setup.editor.action(ctx=>{
      const doc=parseVisualMarkdown(ctx,`:::group{${Object.entries(purple).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join(' ')}}\n正文\n:::`);
      const out=serializeVisualMarkdown(ctx,doc),reopened=parseVisualMarkdown(ctx,out);assert.ok(doc.eq(reopened));return reopened.firstChild!.attrs.attributes;
    });
    assert.equal(selectedPreset(restored),'purple');
    const resumed=updateGroupAttributes(restored,{preset:'custom'});
    assert.equal(blockStyle(resumed),blockStyle(custom));assert.equal(resumed.layout,'grid');
  }finally{await setup.close();}
  assert.equal(blockStyle(legacy),original,'legacy input must not be mutated');
});

test('first custom edit preserves plain and shortcut bases, and legacy overrides survive preset selection',async()=>{
  const chosen=updateGroupAttributes(updateGroupAttributes({preset:'outline',styleVersion:'2'},{preset:'green'}),{preset:'purple'});
  assert.equal(chosen.customBase,undefined,'selecting presets alone must not capture a stale custom base');
  const firstEdit=updateGroupAttributes(chosen,{padding:'24px'});
  assert.equal(firstEdit.customBase,'purple');assert.match(blockStyle(firstEdit),/background-color:#f5ccf35c/);assert.match(blockStyle(firstEdit),/padding:24px/);
  const plain=updateGroupAttributes({preset:'plain'},{background:'#abcdef'});
  assert.ok(groupClasses(plain).includes('preset-plain'));
  const card=updateGroupAttributes({preset:'shortcut',href:'/links'},{padding:'24px'});
  assert.ok(groupClasses(card).includes('shortcut-card'));
  assert.equal(load((await renderMarkdown(`:::group{preset="custom" customBase="shortcut" styleVersion="2" href="/links" padding="24px"}\n卡片\n:::`)).html)('a.shortcut-card').attr('href'),'/links');
  const switched=updateGroupAttributes({preset:'purple',padding:'9px'},{preset:'yellow'});
  assert.equal(switched.customBase,'purple');assert.doesNotMatch(blockStyle(switched),/padding:9px/);
  assert.match(blockStyle(updateGroupAttributes(switched,{preset:'custom'})),/padding:9px/);
});

test('HTML blocks preserve exact source, empty blocks and embedded backticks across visual and source modes',async()=>{
  const setup=await createTestEditor();try{
    for(const value of ['', '<section>\n\n  <p>中文 &amp; <strong>HTML</strong></p>\n\n</section>', '<div>```\n::::tabs\n</div>\n']){
      setup.editor.action(ctx=>{
        const doc=parseVisualMarkdown(ctx,htmlBlockMarkdown(value));assert.equal(doc.firstChild!.type.name,'salmon_html');assert.equal(doc.firstChild!.attrs.value,value);
        const out=serializeVisualMarkdown(ctx,doc),again=parseVisualMarkdown(ctx,out);assert.ok(doc.eq(again));assert.equal(again.firstChild!.attrs.value,value);
      });
    }
    setup.editor.action(ctx=>{
      const source='::::group{preset="outline"}\n'+htmlBlockMarkdown('<div>\n\n内容\n\n</div>')+'\n::::\n\n```html\n<div>作为代码显示</div>\n```';
      const doc=parseVisualMarkdown(ctx,source),again=parseVisualMarkdown(ctx,serializeVisualMarkdown(ctx,doc));assert.ok(equivalentVisualDocuments(doc,again));assert.equal(doc.lastChild!.type.name,'code_block');
    });
  }finally{await setup.close();}
  assert.equal(blockAtLine(htmlBlockMarkdown('<p>HTML</p>'),2)?.name,'html');
  assert.equal(blockAtLine('```html\n<p>代码</p>\n```',2)?.name,'code');
});

test('custom HTML preview uses the same safe renderer while ordinary HTML fences remain code',async()=>{
  const source='<div style="padding:12px;background-color:#abcdef;position:fixed">\n<p><strong>自定义内容</strong></p>\n<script>alert(1)</script><img src="javascript:alert(1)" onerror="alert(1)">\n</div>';
  const html=(await renderMarkdown(htmlBlockMarkdown(source)+'\n\n```html\n<p>代码示例</p>\n```')).html,$=load(html);
  assert.equal($('div>p>strong').text(),'自定义内容');assert.match($('div[style]').attr('style')||'',/padding:12px/);
  assert.doesNotMatch(html,/<script|onerror|javascript:|position:fixed/);assert.equal($('pre').length,1);assert.match($('pre').text(),/<p>代码示例<\/p>/);
});

test('tab activation is ephemeral and add, move, delete and undo preserve every panel',async()=>{
  const setup=await createTestEditor();try{
    const doc=setup.editor.action(ctx=>parseVisualMarkdown(ctx,editorInsertions.find(item=>item.key==='tabs')!.markdown));
    let state=EditorState.create({doc,plugins:[history(),visualTabsPlugin()]});
    const apply=(tr:any)=>{assert.ok(tr);state=state.apply(tr);};
    const original=state.doc;
    apply(activateTab(state,0,1));assert.ok(state.doc.eq(original));assert.equal(visualTabsKey.getState(state)?.get(0)?.active,1);
    apply(tabTransaction(state,0,'add'));assert.equal(state.doc.firstChild!.childCount,3);assert.equal(visualTabsKey.getState(state)?.get(0)?.active,2);
    apply(state.tr.insertText('第三页，不能丢失'));
    const third=tabChildren(state.doc.firstChild!,0)[2];
    apply(state.tr.setNodeMarkup(third.position,undefined,{attributes:{title:'新的标题'}}));
    apply(tabTransaction(state,third.position,'left'));
    let tabs=tabChildren(state.doc.firstChild!,0);assert.equal(tabs[1].node.attrs.attributes.title,'新的标题');assert.equal(tabs[1].node.textContent,'第三页，不能丢失');assert.equal(visualTabsKey.getState(state)?.get(0)?.active,1);
    apply(deleteBlockTransaction(state,tabs[1].position));assert.equal(state.doc.firstChild!.childCount,2);
    assert.ok(undo(state,apply));tabs=tabChildren(state.doc.firstChild!,0);assert.equal(tabs[1].node.textContent,'第三页，不能丢失');assert.equal(visualTabsKey.getState(state)?.get(0)?.active,1);
    assert.ok(redo(state,apply));assert.equal(state.doc.firstChild!.childCount,2);
    const out=setup.editor.action(ctx=>serializeVisualMarkdown(ctx,state.doc));assert.doesNotMatch(out,/editor-tabs|activeTab|data-tab-hidden/);
    assert.equal((out.match(/title=/g)||[]).length,2);
  }finally{await setup.close();}
});

test('selection and history reveal hidden panels, and tab state follows edits before its group',async()=>{
  const setup=await createTestEditor();try{
    const doc=setup.editor.action(ctx=>parseVisualMarkdown(ctx,'前言\n\n'+editorInsertions.find(item=>item.key==='tabs')!.markdown));
    let groupPosition=doc.firstChild!.nodeSize;
    let state=EditorState.create({doc,plugins:[history(),visualTabsPlugin()]});
    const second=tabChildren(state.doc.nodeAt(groupPosition)!,groupPosition)[1];
    state=state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(second.position+2))));
    assert.equal(visualTabsKey.getState(state)?.get(groupPosition)?.active,1);
    const firstText=state.doc.firstChild!.textContent;
    state=state.apply(state.tr.insertText('新增',1));groupPosition+=2;
    assert.equal(state.doc.firstChild!.textContent,'新增'+firstText);assert.equal(visualTabsKey.getState(state)?.get(groupPosition)?.active,1);
    const before=state.doc;
    state=state.apply(activateTab(state,groupPosition,0));assert.ok(state.doc.eq(before));
  }finally{await setup.close();}
});

test('deletion targets nested blocks, keeps the last tab and leaves a writable document',async()=>{
  const setup=await createTestEditor();try{
    setup.editor.action(ctx=>{
      const doc=parseVisualMarkdown(ctx,'::::group{preset="outline"}\n:::details{title="内层"}\n内容\n:::\n\n保留外层\n::::');
      let state=EditorState.create({doc,plugins:[history(),visualTabsPlugin()]});
      state=state.apply(deleteBlockTransaction(state,1)!);assert.equal(state.doc.firstChild!.type.name,'salmon_group');assert.match(state.doc.textContent,/保留外层/);assert.doesNotMatch(state.doc.textContent,/内容/);
      state=state.apply(deleteBlockTransaction(state,0)!);assert.equal(state.doc.firstChild!.type.name,'paragraph');assert.ok(state.selection instanceof TextSelection);
      state=state.apply(state.tr.insertText('继续写作'));assert.equal(state.doc.textContent,'继续写作');
      const tabs=parseVisualMarkdown(ctx,'::::tabs\n:::tab{title="唯一标签"}\n保留\n:::\n::::');
      const only=EditorState.create({doc:tabs,plugins:[visualTabsPlugin()]});assert.equal(deleteBlockTransaction(only,1),null);assert.ok(deleteBlockTransaction(only,0));
    });
  }finally{await setup.close();}
});

test('all shared insertions parse and round trip through the visual schema',async()=>{
  const setup=await createTestEditor();try{
    for(const item of editorInsertions)setup.editor.action(ctx=>{const doc=parseVisualMarkdown(ctx,item.markdown);const out=serializeVisualMarkdown(ctx,doc);assert.ok(equivalentVisualDocuments(doc,parseVisualMarkdown(ctx,out)),item.key);});
  }finally{await setup.close();}
});

test('HTML preview failures retain source, retry works and stale responses never replace newer output',async()=>{
  const setup=await createTestEditor(),previousFetch=globalThis.fetch;
  let renderer:ReturnType<ReturnType<typeof sourceBlockView>>|undefined;
  const pause=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));
  try{
    const source='<div>原始源码\n\n<script>not executed</script></div>';
    const doc=setup.editor.action(ctx=>parseVisualMarkdown(ctx,htmlBlockMarkdown(source)));
    const view:any={state:EditorState.create({doc}),dispatch(tr:any){this.state=this.state.apply(tr);renderer?.update?.(this.state.doc.firstChild,[],DecorationSet.empty);},focus(){}};
    globalThis.fetch=async()=>{throw new Error('offline');};
    renderer=sourceBlockView(true)(doc.firstChild!,view,()=>0,[],DecorationSet.empty);
    const dom=renderer.dom as HTMLElement;document.body.append(dom);
    const input=dom.querySelector('textarea')!,preview=dom.querySelector('.html-block-preview')!,retry=Array.from(dom.querySelectorAll('button')).find(button=>button.textContent==='重试预览')!;
    await pause(400);
    assert.equal(input.value,source);assert.equal(retry.hidden,false);assert.match(dom.textContent||'',/源码已保留/);assert.equal(dom.querySelector('script'),null);
    let finishOld!:(response:Response)=>void;
    globalThis.fetch=()=>new Promise<Response>(resolve=>{finishOld=resolve;});retry.click();await pause(400);assert.ok(finishOld);
    globalThis.fetch=async(_url,options)=>{assert.match(String(options?.body),/最新源码/);return Response.json({html:'<p>最新预览</p>'});};
    input.value='<p>最新源码</p>';input.dispatchEvent(new Event('input',{bubbles:true}));await pause(400);
    assert.equal(view.state.doc.firstChild.attrs.value,'<p>最新源码</p>');assert.equal(preview.textContent,'最新预览');assert.equal(retry.hidden,true);
    finishOld(Response.json({html:'<p>过期预览</p>'}));await pause(20);assert.equal(preview.textContent,'最新预览');
    dom.remove();
  }finally{renderer?.destroy?.();globalThis.fetch=previousFetch;await setup.close();}
});
