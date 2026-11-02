export const presets = {
  outline: { background: 'transparent', borderColor: 'currentColor' },
  purple: { background: '#f5ccf35c', borderColor: '#6969698f' },
  yellow: { background: '#ffee575c', borderColor: '#6969698f' },
  green: { background: '#cee5bd', color: '#111111', borderColor: '#315f25', borderWidth: '1px', borderStyle: 'solid', radius: '3px', padding: '10px 20px', margin: '20px 0', fontSize: '1.125rem', lineHeight: '1.3' },
  shortcut: {},
  plain: {},
  custom: {},
};
export const presetLabels: Record<keyof typeof presets,string> = { outline:'透明描边', purple:'淡紫', yellow:'淡黄', green:'淡绿', shortcut:'链接卡片', plain:'无预设', custom:'自定义' };
export function presetName(value: unknown): keyof typeof presets { return typeof value==='string' && Object.hasOwn(presets,value) ? value as keyof typeof presets : 'outline'; }
/** Legacy groups keep their explicit overrides until their styles are edited. */
export function selectedPreset(attrs:Record<string,unknown>):keyof typeof presets {
  return attrs.styleVersion!=='2'&&styleFields.some(key=>typeof attrs[key]==='string'&&attrs[key]!=='' )?'custom':presetName(attrs.preset);
}
export function groupBasePreset(attrs:Record<string,unknown>):keyof typeof presets {
  return attrs.preset==='custom'?presetName(attrs.customBase==='custom'?'outline':attrs.customBase):presetName(attrs.preset);
}
export function groupClasses(attrs:Record<string,unknown>):string[] {
  const preset=presetName(attrs.preset),base=groupBasePreset(attrs);
  return ['content-group',`preset-${preset}`,...(preset==='custom'&&base!==preset?[`preset-${base}`]:[]),...(base==='shortcut'?['shortcut-card']:[]),...(['row','grid'].includes(String(attrs.layout))?[`layout-${attrs.layout}`]:[])];
}
/** A single patch is used by both visual transactions and source controls. */
export function updateGroupAttributes(attrs:Record<string,string>,patch:Record<string,string>):Record<string,string> {
  const editsStyle=Object.keys(patch).some(key=>styleFields.includes(key as StyleField));
  if(!editsStyle&&!Object.hasOwn(patch,'preset'))return {...attrs,...patch};
  const base=groupBasePreset(attrs);
  const capture=!attrs.customBase&&(editsStyle||patch.preset==='custom'||attrs.preset==='custom'||styleFields.some(key=>!!attrs[key]));
  const next:Record<string,string>={...(capture?presets[base]:{}),...attrs,...patch,styleVersion:'2',...(capture?{customBase:base}:{})};
  next.preset=Object.hasOwn(patch,'preset')?presetName(patch.preset):'custom';
  for(const key of Object.keys(next))if(next[key]==='')delete next[key];
  return next;
}
/** Card destinations support local paths and ordinary web/email links. */
export function shortcutHref(value: unknown): string | undefined {
  if(typeof value!=='string')return;
  const href=value.trim();
  if(!href||/[\u0000-\u0020\u007f\\]/.test(href))return;
  if(/^(?:\/(?!\/)|\.{1,2}\/|#)/.test(href))return href;
  if(/^mailto:[^\s]+$/i.test(href))return href;
  if(/^https?:\/\//i.test(href)){try{if(new URL(href).hostname)return href;}catch{}}
}
export const styleFields = ['background','color','borderColor','borderWidth','borderStyle','radius','padding','margin','gap','fontSize','lineHeight','textAlign'] as const;
export type StyleField = typeof styleFields[number];
const color = /^(?:#[\da-f]{3,8}|transparent|currentColor|(?:rgb|hsl)a?\([\d.,% /-]+\))$/i;
const length = /^(?:0|\d+(?:\.\d+)?(?:px|rem|em|%))(?:\s+(?:0|\d+(?:\.\d+)?(?:px|rem|em|%))){0,3}$/;
export function validStyle(name: string, value: string) {
  if (['background','color','borderColor'].includes(name)) return color.test(value);
  if (name === 'borderStyle') return /^(solid|dashed|dotted|double|none)$/.test(value);
  if (name === 'lineHeight') return /^(?:[0-9](?:\.\d{1,2})?|\d+(?:\.\d+)?(?:px|rem|em))$/.test(value);
  if (name === 'textAlign') return /^(left|right|center|justify|start|end)$/.test(value);
  return styleFields.includes(name as StyleField) && length.test(value);
}
const cssNames: Record<string,string> = { background:'background-color',color:'color',borderColor:'border-color',borderWidth:'border-width',borderStyle:'border-style',radius:'border-radius',padding:'padding',margin:'margin',gap:'gap',fontSize:'font-size',lineHeight:'line-height',textAlign:'text-align' };
export function blockStyle(attributes: Record<string,unknown>) {
  if(attributes.preset){
    const preset=presetName(attributes.preset);
    attributes=attributes.styleVersion==='2'&&preset!=='custom'?presets[preset]:{...presets[groupBasePreset(attributes)],...attributes};
  }
  return styleFields.flatMap(key => typeof attributes[key] === 'string' && validStyle(key,attributes[key]) ? [`${cssNames[key]}:${attributes[key]}`] : []).join(';');
}
export function cleanInlineStyle(style: string) {
  const reverse = Object.fromEntries(Object.entries(cssNames).map(([k,v])=>[v,k]));
  return style.split(';').flatMap(pair => {
    const colon = pair.indexOf(':'); if (colon<0) return [];
    const key = pair.slice(0,colon).trim().toLowerCase(); const val = pair.slice(colon+1).trim();
    return reverse[key] && validStyle(reverse[key],val) ? [`${key}:${val}`] : [];
  }).join(';');
}
