import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editorViewCtx} from '@milkdown/kit/core';
import {EditorState,TextSelection} from '@milkdown/kit/prose/state';
import {createTestEditor} from './helpers/visual-editor';
import {parseVisualMarkdown,serializeVisualMarkdown} from '../src/lib/visual-schema';
import {formatInline,headingTransaction,inlineEdit,inlineSyntax,liveMarkdownPlugin} from '../src/lib/live-markdown';
import {htmlClipboardMarkdown,clipboardMarkdown} from '../src/lib/editor-clipboard';
import {renderMarkdown} from '../src/lib/markdown';

const prose='在**模型评估**中，我们通常先检查 `batch_size`，观察 $L(\\theta)$；学习率 $\\eta$ 可能 *不稳定*，指标 $M_{\\mathrm{val}}$ 与 `train.log`。';

test('live text keeps editable Markdown and incomplete delimiters through serialization',async()=>{
  const setup=await createTestEditor({live:true});try{setup.editor.action(ctx=>{
    for(const source of [prose,'**模型评估*','`broken','$x^2','## **标题**','---','<mark style="color:#123456">**有色**</mark>']){
      const doc=parseVisualMarkdown(ctx,source),out=serializeVisualMarkdown(ctx,doc);
      assert.equal(doc.textContent,source);assert.equal(out.trim(),source);assert.ok(parseVisualMarkdown(ctx,out).eq(doc),source);
    }
  });}finally{await setup.close();}
});

test('five caret positions reveal the same real bold markers without changing the document',async()=>{
  const setup=await createTestEditor({live:true});try{setup.editor.action(ctx=>{
    const doc=parseVisualMarkdown(ctx,'在**模型评估**中，普通文字'),plugin=liveMarkdownPlugin();
    for(const offset of [3,4,5,6,7]){
      const state=EditorState.create({doc,selection:TextSelection.create(doc,1+offset),plugins:[plugin]});
      const decorations=(plugin.props.decorations!.call(plugin,state) as any).find();
      assert.equal(decorations.filter((d:any)=>d.type.attrs?.class==='live-syntax-hidden').length,0);
      assert.ok(state.doc.eq(doc));
    }
    const state=EditorState.create({doc,selection:TextSelection.create(doc,doc.content.size-1),plugins:[plugin]});
    assert.equal((plugin.props.decorations!.call(plugin,state) as any).find().filter((d:any)=>d.type.attrs?.class==='live-syntax-hidden').length,2);
  });}finally{await setup.close();}
});

test('source formatting wraps, unwraps, chooses safe backticks and rejects multiple paragraphs',async()=>{
  assert.equal(inlineEdit('a`b',0,3,'inlineCode')?.insert,'``a`b``');
  assert.equal(inlineEdit('x\ny',0,3,'inlineMath'),null);
  const setup=await createTestEditor({live:true});try{setup.editor.action(ctx=>{
    const doc=parseVisualMarkdown(ctx,'x^2'),state=EditorState.create({doc,selection:TextSelection.create(doc,1,4)});
    const tr=formatInline(state,'inlineMath')!;assert.equal(tr.doc.textContent,'$x^2$');
    const unwrapped=formatInline(state.apply(tr),'inlineMath')!;assert.equal(unwrapped.doc.textContent,'x^2');
    const empty=EditorState.create({doc,selection:TextSelection.create(doc,1)});const code=formatInline(empty,'inlineCode')!;
    assert.equal(code.doc.textContent,'``x^2');assert.equal(code.selection.from,2);
  });}finally{await setup.close();}
});

test('editing heading and rule prefixes updates structure with the same source and caret',async()=>{
  const setup=await createTestEditor({live:true});try{setup.editor.action(ctx=>{
    const view=ctx.get(editorViewCtx),doc=parseVisualMarkdown(ctx,'## 标题\n\n---');view.dispatch(view.state.tr.replaceWith(0,view.state.doc.content.size,doc.content));
    view.dispatch(view.state.tr.delete(1,2));assert.equal(view.state.doc.firstChild!.attrs.level,1);
    view.dispatch(view.state.tr.delete(1,3));assert.equal(view.state.doc.firstChild!.type.name,'paragraph');
    let position=view.state.doc.firstChild!.nodeSize;view.dispatch(view.state.tr.delete(position+1,position+2));assert.equal(view.state.doc.lastChild!.type.name,'paragraph');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,1)));
    view.dispatch(headingTransaction(view.state,3)!);assert.equal(view.state.doc.firstChild!.type.name,'heading');assert.equal(view.state.doc.firstChild!.textContent,'### 标题');
  });}finally{await setup.close();}
});

test('Chinese composition keeps source and selection intact and updates heading style after composition ends',async()=>{
  const setup=await createTestEditor({live:true});try{
    const view=setup.editor.action(ctx=>ctx.get(editorViewCtx));
    view.dispatch(view.state.tr.insertText('# 中文输入').setMeta('composition',1));
    const anchor=view.state.selection.anchor;assert.equal(view.state.doc.textContent,'# 中文输入');assert.equal(view.state.doc.firstChild!.type.name,'paragraph');
    const plugin=liveMarkdownPlugin();(plugin.props.handleDOMEvents!.compositionend as any)(view,new window.Event('compositionend'));
    await Promise.resolve();assert.equal(view.state.doc.firstChild!.type.name,'heading');assert.equal(view.state.doc.textContent,'# 中文输入');assert.equal(view.state.selection.anchor,anchor);
  }finally{await setup.close();}
});

test('nested source syntax has matching offsets while code and math contents stay literal',()=>{
  const syntax=inlineSyntax('**粗体 *嵌套*** 与 `$x$` 与 $\\text{a*b}$');
  assert.equal(syntax.filter(x=>x.kind==='strong').length,1);assert.equal(syntax.filter(x=>x.kind==='emphasis').length,1);
  assert.equal(syntax.filter(x=>x.kind==='inlineMath').length,1);assert.equal(syntax.filter(x=>x.kind==='inlineCode').length,1);
  const url=inlineSyntax('https://example.test/path')[0];assert.equal(url.from,url.contentFrom);assert.equal(url.to,url.contentTo);
});

test('KaTeX rich clipboard extracts each formula once and retains surrounding formatting',async()=>{
  const setup=await createTestEditor({live:true});try{
    const html=(await renderMarkdown(prose)).html,markdown=htmlClipboardMarkdown(html);
    assert.equal(inlineSyntax(markdown).filter(x=>x.kind==='inlineMath').length,3);
    assert.match(markdown,/\$L\(\\theta\)\$/);assert.match(markdown,/\$M_\{\\mathrm\{val\}\}\$/);
    assert.match(markdown,/\*\*模型评估\*\*/);assert.match(markdown,/`batch_size`/);
    assert.equal(((await renderMarkdown(markdown)).html.match(/class="katex"/g)||[]).length,3);
    const data={getData:(type:string)=>type==='text/html'?html:type==='text/plain'?'DUPLICATED_MATH_TEXT':''};
    assert.equal(clipboardMarkdown(data),markdown);
    assert.equal(clipboardMarkdown({getData:type=>type==='text/plain'?prose:''}),prose);
  }finally{await setup.close();}
});

test('live source retains images, captions, nested containers, tables and list continuation',async()=>{
  const setup=await createTestEditor({live:true});try{setup.editor.action(ctx=>{
    for(const source of ['::::group{preset="green"}\n**正文** $x$\n\n: image\n::::','- **第一项**\n- 第二项','> **引用**\n> 第二行','| A | B |\n| - | - |\n| **粗体** | $x$ |',':image[替代]{src="/image.png" caption="说明 **加粗**"}']){
      const doc=parseVisualMarkdown(ctx,source),out=serializeVisualMarkdown(ctx,doc);assert.ok(parseVisualMarkdown(ctx,out).eq(doc),out);
    }
  });}finally{await setup.close();}
});
