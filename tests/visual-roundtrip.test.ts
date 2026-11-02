import {createTestEditor,equivalentVisualDocuments} from './helpers/visual-editor';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parserCtx,serializerCtx} from '@milkdown/kit/core';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import {visit} from 'unist-util-visit';

test('visual Markdown schema round trips nested blocks, styled spans, formulas and code options',async()=>{
  const setup=await createTestEditor();
  try{
    const source='# 标题\n\n:::::group{preset="purple" padding="15px"}\n**粗体中文：**内容。\n\n::::details{title="折叠" open="true"}\n:::group{preset="yellow"}\n嵌套内容\n:::\n::::\n:::::\n\n::::tabs\n:::tab{title="A"}\n第一项\n:::\n:::tab{title="B"}\n第二项\n:::\n::::\n\n::::columns\n:::column\n左栏\n:::\n:::column\n右栏\n:::\n::::\n\n:::gallery\n![图片](/api/media/example)\n:::\n\n- [ ] 任务\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n行内 $x^2$。\n\n$$\n\\begin{pmatrix}a & b\\\\ c & d\\end{pmatrix}\n$$\n\n```java start=23 highlight="24-25" blur="26"\nraw < & >\nsecond\n```\n\n<mark style="background-color:#ffee57">样式 **加粗**</mark> 与 <code>inline()</code>。\n\n:::future{key="preserved"}\n未知内容\n:::';
    const result=setup.editor.action(ctx=>{const parsed=ctx.get(parserCtx)(source);const markdown=ctx.get(serializerCtx)(parsed);const reparsed=ctx.get(parserCtx)(markdown);assert.ok(parsed.eq(reparsed),'editor document changes during a Markdown round trip');return markdown;});
    assert.match(result,/start=23 highlight="24-25" blur="26"/);assert.match(result,/preset="purple"/);assert.match(result,/padding="15px"/);assert.match(result,/title="折叠" open="true"/);assert.ok(result.includes('\\begin{pmatrix}a & b\\\\ c & d\\end{pmatrix}'));assert.match(result,/<mark style="background-color:#ffee57">/);assert.match(result,/<code>inline\(\)<\/code>/);assert.match(result,/future\{key="preserved"\}/);assert.match(result,/raw < & >/);
    const tree=unified().use(remarkParse).use(remarkMath).use(remarkDirective).use(remarkGfm).parse(result);let containers=0,formulas=0;visit(tree,(node:any)=>{if(node.type==='containerDirective')containers++;if(node.type==='math'||node.type==='inlineMath')formulas++;});assert.equal(containers,11);assert.equal(formulas,2);
  }finally{await setup.close();}
});

test('visual schema preserves empty containers, inline HTML and clock-like colon text',async()=>{
  const setup=await createTestEditor();try{
    for(const source of [':::group{preset="plain"}\n\n:::','截止 23:59。','<a href="https://example.test">链接</a>',':::group{preset="plain"}\n<br />\n:::','**Algorithm: A **<mark style="background-color:#ffee57">finite</mark> sequence.']){
      const [before,after]=setup.editor.action(ctx=>{const before=ctx.get(parserCtx)(source);const after=ctx.get(parserCtx)(ctx.get(serializerCtx)(before));return[before,after];});assert.ok(equivalentVisualDocuments(before,after),source);
    }
  }finally{await setup.close();}
});
