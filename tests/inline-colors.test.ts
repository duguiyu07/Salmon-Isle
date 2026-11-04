import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {EditorState,TextSelection} from '@milkdown/kit/prose/state';
import {inlineColorPair,inlineColorStyle,colorContrast,textColors,highlightColors,normalizeColor} from '../src/lib/inline-color';
import {inlineColorEdit,sourceColorEdits} from '../src/lib/inline-color-edit';
import {colorTransaction,inlineSyntax} from '../src/lib/live-markdown';
import {renderMarkdown} from '../src/lib/markdown';
import {parseVisualMarkdown,serializeVisualMarkdown} from '../src/lib/visual-schema';
import {htmlClipboardMarkdown} from '../src/lib/editor-clipboard';
import {createTestEditor} from './helpers/visual-editor';
import {undo} from '@milkdown/kit/prose/history';
import {editorViewCtx} from '@milkdown/kit/core';

test('presets and custom colors meet contrast in both themes including combined backgrounds',()=>{
  for(const color of [...Object.keys(textColors),'#ffffff','#000000','#ff00ff','#abc'])for(const background of [undefined,...Object.keys(highlightColors),'#777777','#00ff00']){
    const pair=inlineColorPair({color,background});for(const theme of [pair.light,pair.dark])assert.ok(colorContrast(theme.color,theme.background)>=4.5,JSON.stringify({color,background,theme}));
  }
  assert.equal(normalizeColor('#AbC','color'),'#aabbcc');assert.equal(normalizeColor('url(evil)','color'),undefined);
});
test('colored inline content renders nested Markdown, safe paired styles and clipboard metadata',async()=>{
  const source=':text[重点 **中文** [链接](/about)]{color="red" background="yellow"}';
  const html=(await renderMarkdown(source)).html,$=load(html);
  assert.equal($('.inline-colored-text strong').text(),'中文');assert.equal($('.inline-colored-text a').attr('href'),'/about');assert.match($('.inline-colored-text').attr('style')||'',/color:light-dark\(#[a-f0-9]{6},#[a-f0-9]{6}\)/);assert.equal($('.inline-colored-text').attr('data-text-background'),'yellow');
  const unsafe=(await renderMarkdown(':text[文字]{color="url(javascript:evil)" background="yellow" onclick="evil"}')).html;assert.doesNotMatch(unsafe,/onclick|javascript|url\(/);
});
test('normal and live schema round trip colors, preserve composition source and copy nested formatting',async()=>{
  for(const live of [false,true]){const setup=await createTestEditor({live});try{
    setup.editor.action(ctx=>{const source=':text[中文 **加粗**]{color="#123456" background="pink"}',doc=parseVisualMarkdown(ctx,source),out=serializeVisualMarkdown(ctx,doc);assert.ok(parseVisualMarkdown(ctx,out).eq(doc));if(live)assert.equal(out.trim(),source);});
    const html=(await renderMarkdown(':text[中文 **加粗**]{color="blue" background="pink"}')).html,copy=htmlClipboardMarkdown(html);assert.match(copy,/:text\[/);assert.match(copy,/\*\*加粗\*\*/);assert.match(copy,/background="pink"/);
  }finally{await setup.close();}}
});
test('partial color changes preserve emphasis, background and surrounding text, and clear independently',async()=>{
  const source=':text[**abcdef**]{color="red" background="yellow"}',from=source.indexOf('cd'),edit=inlineColorEdit(source,from,from+2,'color','blue')!;
  const out=source.slice(0,edit.from)+edit.insert+source.slice(edit.to),$=load((await renderMarkdown(out)).html);assert.equal($('p').text(),'abcdef');assert.equal($('strong').text(),'abcdef');assert.equal($('[data-text-color=blue]').text(),'cd');assert.equal($('[data-text-background=yellow]').length,3);
  const clear=inlineColorEdit(':text[内容]{color="red" background="yellow"}',6,8,'color','')!;assert.doesNotMatch(clear.insert,/color=/);assert.match(clear.insert,/background="yellow"/);
  const empty=inlineColorEdit('abc',1,1,'color','blue')!;assert.equal(empty.insert,':text[]{color="blue"}');assert.equal(empty.anchor,7);
});
test('source and visual multi-paragraph colors preserve list structure and undo together',async()=>{
  const source='- 第一项\n- 第二项\n\n## 标题',edits=sourceColorEdits(source,0,source.length,'background','yellow');let out=source;for(const edit of edits.toReversed())out=out.slice(0,edit.from)+edit.insert+out.slice(edit.to);const $=load((await renderMarkdown(out)).html);assert.equal($('li').length,2);assert.equal($('h2').text(),'标题');assert.equal($('.inline-colored-text').length,3);
  const setup=await createTestEditor({live:true,views:true});try{setup.editor.action(ctx=>{const view=ctx.get(editorViewCtx),doc=parseVisualMarkdown(ctx,'第一段\n\n第二段');view.dispatch(view.state.tr.replaceWith(0,view.state.doc.content.size,doc.content));view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,1,view.state.doc.content.size-1)));const before=view.state.doc,tr=colorTransaction(view.state,'color','red')!;view.dispatch(tr);assert.equal(inlineSyntax(view.state.doc.firstChild!.textContent).filter(range=>range.kind==='text').length,1);assert.match(serializeVisualMarkdown(ctx,view.state.doc),/第二段/);undo(view.state,view.dispatch.bind(view));assert.ok(view.state.doc.eq(before));});}finally{await setup.close();}
});
test('crossing a colored boundary and unmatched brackets preserve visible text',async()=>{
  for(const [source,from,to]of [[':text[abc]{color="red"}def',7,23],['a ] b [ c',0,9]] as [string,number,number][]){
    const before=load((await renderMarkdown(source)).html)('p').text(),edit=inlineColorEdit(source,from,to,'color','blue')!,out=source.slice(0,edit.from)+edit.insert+source.slice(edit.to);
    assert.equal(load((await renderMarkdown(out)).html)('p').text(),before,out);
  }
});
test('clearing a nested color removes its inherited foreground while retaining the highlight',async()=>{
  const source=':text[a :text[b]{background="yellow"} c]{color="red"}',from=source.indexOf('b]'),edit=inlineColorEdit(source,from,from+1,'color','')!,out=source.slice(0,edit.from)+edit.insert+source.slice(edit.to),$=load((await renderMarkdown(out)).html);
  assert.equal($('p').text(),'a b c');assert.equal($('[data-text-background=yellow]').text(),'b');assert.equal($('[data-text-color=red]').text(),'a  c');assert.equal($('[data-text-color=red] [data-text-background]').length,0);
});
test('nested text colors use the actual inherited highlight in reading and live editing',async()=>{
  const source=':text[外层 **:text[内层]{color="blue"}**]{background="yellow"}',expected=inlineColorStyle({color:'blue',background:'yellow'}),$=load((await renderMarkdown(source)).html);
  assert.equal($('[data-text-color=blue]').attr('style'),expected);assert.equal(inlineSyntax(source).filter(range=>range.kind==='text').at(-1)?.style,expected);
});
test('clearing nested styles with a caret remaps the caret after removed Markdown markers',()=>{
  const source=':text[x :text[abc]{color="blue"} y]{color="red"}',at=source.indexOf(' y'),edit=inlineColorEdit(source,at,at,'color','')!;
  assert.equal(edit.insert,'x abc y');assert.equal(edit.anchor,5);assert.equal(edit.head,5);
});
