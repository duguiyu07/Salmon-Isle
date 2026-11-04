'use client';
import type {PageDocument} from '@/lib/editor-draft-model';
const accessNames={inherit:'继承上级',public:'公开',password:'密码保护',private:'私密'};
export function PageSettings({doc,onChange}:{doc:PageDocument;onChange:(patch:Partial<PageDocument>)=>void}){
  return <div className="article-settings"><div className="article-settings-grid">
    <label className="settings-full">页面地址<input aria-label="页面地址" placeholder="/example" value={doc.route||''} onChange={event=>onChange({route:event.target.value})}/></label>
    <label className="settings-full">访问权限<select value={doc.access||'inherit'} onChange={event=>onChange({access:event.target.value as PageDocument['access']})}>{Object.entries(accessNames).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    {doc.access==='password'&&<label className="settings-full">{doc.hasPassword?'更换密码（留空保持）':'设置访问密码'}<input type="password" autoComplete="new-password" value={doc.password||''} onChange={event=>onChange({password:event.target.value})}/></label>}
    <label className="settings-full">旧地址别名（每行一个）<textarea rows={2} value={(doc.aliases||[]).join('\n')} onChange={event=>onChange({aliases:event.target.value.split('\n').filter(Boolean)})}/></label>
    {['/misc','/links'].includes(doc.route||'')&&<label className="settings-full">评论关联值<input value={doc.giscusTerm||''} onChange={event=>onChange({giscusTerm:event.target.value})} placeholder="默认使用永久 ID"/></label>}
  </div></div>;
}
