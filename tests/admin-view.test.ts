import {test} from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {adminHref,parseAdminView,lastModified} from '../src/lib/admin-view';
import {browserRecoveries,saveBrowserRecovery,clearBrowserRecovery} from '../src/lib/browser-recovery';
test('admin URLs round trip list filters and document links without writing content',()=>{
 const view={section:'articles',folder:'目录 & id',q:'中文 / SQL',status:'draft',edit:'article-id'};
 assert.deepEqual(parseAdminView(new URL(adminHref(view),'http://test').searchParams),{...view,new:undefined});assert.equal(parseAdminView(new URLSearchParams('section=commits')).section,'articles');assert.equal(parseAdminView(new URLSearchParams('new=page')).new,'page');
 assert.equal(lastModified({updatedAt:'2026-01-01'},{savedAt:'2026-02-01'}),'2026-02-01');
});
test('recovery drafts isolate documents and sessions, redact passwords and read legacy recovery',()=>{
 const dom=new JSDOM('',{url:'https://example.test'}),previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');Object.defineProperty(globalThis,'localStorage',{configurable:true,value:dom.window.localStorage});
 try{const document={id:'a',title:'A',body:'text',folderId:'root',password:'do-not-store'};saveBrowserRecovery('tab-one',document);saveBrowserRecovery('tab-two',{...document,body:'other tab'});saveBrowserRecovery('tab-one',{...document,id:'b'});
 assert.equal(browserRecoveries().length,3);assert.doesNotMatch(JSON.stringify(browserRecoveries()),/do-not-store/);clearBrowserRecovery('tab-one','a');assert.equal(browserRecoveries().length,2);assert.ok(browserRecoveries().some(item=>item.document.body==='other tab'));
 localStorage.setItem('salmon-editor-recovery',JSON.stringify(document));assert.ok(browserRecoveries().some(item=>item.key==='salmon-editor-recovery'));
 }finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete (globalThis as any).localStorage;dom.window.close();}
});
