export const textColors={red:'#df4141',orange:'#e67b19',green:'#35864b',blue:'#3478ce',purple:'#9156ba',gray:'#777777'};
export const highlightColors={yellow:'#ffee58',green:'#aaff66',cyan:'#65e6df',blue:'#83b8ff',purple:'#c49aff',pink:'#ff8dc7'};
export const colorLabels:Record<string,string>={red:'红',orange:'橙',green:'绿',blue:'蓝',purple:'紫',gray:'灰',yellow:'黄',cyan:'青',pink:'粉'};
export type ColorField='color'|'background';
export interface InlineColors {color?:string;background?:string}
export function normalizeColor(value:unknown,field:ColorField):string|undefined{
  if(typeof value!=='string')return;
  const input=value.trim().toLowerCase(),presets=field==='color'?textColors:highlightColors;
  if(Object.hasOwn(presets,input))return input;
  if(/^#[\da-f]{6}$/.test(input))return input;
  if(/^#[\da-f]{3}$/.test(input))return '#'+[...input.slice(1)].map(c=>c+c).join('');
}
export function inlineColors(input:Record<string,unknown>):InlineColors{
  return Object.fromEntries((['color','background'] as const).flatMap(field=>{const value=normalizeColor(input[field],field);return value?[[field,value]]:[];}));
}
function rgb(hex:string){return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);}
function hsl(hex:string){const [r,g,b]=rgb(hex),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2;return [d?((max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4)/6):0,d?d/(1-Math.abs(2*l-1)):0,l];}
function hexAt(h:number,s:number,l:number){const a=s*Math.min(l,1-l);return '#'+[0,8,4].map(n=>{const k=(n+h*12)%12;return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');}).join('');}
export function colorContrast(first:string,second:string){const luminance=(hex:string)=>rgb(hex).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);const a=luminance(first),b=luminance(second);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
function readable(hex:string,background:string){
  if(colorContrast(hex,background)>=4.5)return hex;
  const [h,s,l]=hsl(hex);let best=hex,distance=2;
  for(let step=0;step<=1000;step++){const lightness=step/1000,candidate=hexAt(h,s,lightness);if(Math.abs(lightness-l)<distance&&colorContrast(candidate,background)>=4.5){best=candidate;distance=Math.abs(lightness-l);}}
  return best;
}
const pairs=new Map<string,ReturnType<typeof computePair>>();
function computePair(attrs:InlineColors){
  const base=(field:ColorField)=>{const value=attrs[field];return value?.startsWith('#')?value:((field==='color'?textColors:highlightColors) as Record<string,string>)[value||''] as string|undefined;};
  const background=base('background'),foreground=base('color');
  const bg=background?hsl(background):undefined;
  const lightBackground=bg?hexAt(bg[0],bg[1],.82):'#fcfcf7',darkBackground=bg?hexAt(bg[0],bg[1],.28):'#1f1f1f';
  return {light:{color:readable(foreground||'#171916',lightBackground),background:lightBackground},dark:{color:readable(foreground||'#e4e4e4',darkBackground),background:darkBackground}};
}
export function inlineColorPair(input:InlineColors){const attrs=inlineColors(input as Record<string,unknown>),key=JSON.stringify(attrs);let pair=pairs.get(key);if(!pair){pair=computePair(attrs);if(pairs.size>=256)pairs.delete(pairs.keys().next().value!);pairs.set(key,pair);}return pair;}
export function inlineColorStyle(input:InlineColors){
  const attrs=inlineColors(input as Record<string,unknown>);if(!attrs.color&&!attrs.background)return '';
  const {light,dark}=inlineColorPair(attrs);
  return `color:light-dark(${light.color},${dark.color})`+(attrs.background?`;background-color:light-dark(${light.background},${dark.background})`:'');
}
export function coloredText(source:string,attributes:InlineColors){
  const attrs=inlineColors(attributes as Record<string,unknown>),entries=Object.entries(attrs);
  if(!entries.length)return source;
  const stack:number[]=[];
  // Escape unmatched label brackets, while keeping code, HTML and existing escapes literal.
  // Work in UTF-16 offsets, matching editor and Markdown positions.
  const parts=source.split('');
  for(const match of source.matchAll(/(`+)[\s\S]*?\1|\$[^$\n]*\$|<[^>]*>|\\[\s\S]|[\[\]]/g)){
    if(match[0]==='[')stack.push(match.index!);else if(match[0]===']'){if(stack.length)stack.pop();else parts[match.index!]='\\]';}
  }
  for(const index of stack)parts[index]='\\[';
  return `:text[${parts.join('')}]{${entries.map(([key,value])=>`${key}="${value}"`).join(' ')}}`;
}
