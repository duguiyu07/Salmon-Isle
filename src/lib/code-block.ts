export interface CodeOptions { lineNumbers: boolean; start: number; highlight: string; blur: string }
export const defaultCodeOptions: CodeOptions = { lineNumbers: true, start: 1, highlight: '', blur: '' };
export function parseCodeMeta(meta = ''): CodeOptions {
  const values: Record<string,string> = {};
  for (const m of meta.matchAll(/(?:^|\s)(lineNumbers|start|highlight|blur)=(?:"([^"]*)"|'([^']*)'|(\S+))/g)) values[m[1]] = m[2] ?? m[3] ?? m[4];
  const start = Number(values.start);
  return { lineNumbers: values.lineNumbers !== 'false', start: Number.isSafeInteger(start) && start > 0 ? start : 1, highlight: values.highlight || '', blur: values.blur || '' };
}
export function serializeCodeMeta(options: CodeOptions) {
  return [!options.lineNumbers?'lineNumbers=false':'', options.start !== 1?`start=${options.start}`:'', options.highlight?`highlight=${JSON.stringify(options.highlight)}`:'', options.blur?`blur=${JSON.stringify(options.blur)}`:''].filter(Boolean).join(' ');
}
export function lineRange(value: string, start: number, count: number) {
  const result = new Set<number>();
  for (const item of value.slice(0,2000).split(',')) {
    const m = item.trim().match(/^(\d+)(?:-(\d+))?$/); if (!m) continue;
    const first = Math.max(start,Number(m[1])), last = Math.min(start+count-1,Number(m[2]||m[1]));
    for (let n=first;n<=last && result.size<10000;n++) result.add(n);
  }
  return result;
}
export function wordpressCodeMeta(attrs: Record<string,any>, code: string): string {
  const start = Math.max(1, Number(attrs.startingLineNumber) || 1), count = code.trimEnd().split('\n').length;
  const numbers = (value: string) => {
    try { return (JSON.parse(`[${value || ''}]`) as (number | number[])[]).flatMap(v=>Array.isArray(v)?Array.from({length:Math.min(10000,Math.max(0,v[1]-v[0]+1))},(_,i)=>v[0]+i):[v]).filter(n=>Number.isInteger(n)&&n>=start&&n<start+count); } catch { return []; }
  };
  const visible = new Set(numbers(attrs.lineBlurs));
  const blurred = attrs.enableBlurring ? Array.from({length:count},(_,i)=>start+i).filter(n=>!visible.has(n)) : [];
  return serializeCodeMeta({lineNumbers:attrs.lineNumbers !== false,start,highlight:attrs.enableHighlighting?numbers(attrs.lineHighlights).join(','):'',blur:blurred.join(',')});
}
