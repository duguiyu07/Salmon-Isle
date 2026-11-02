import { diffArrays } from 'diff';

/** Exact, source-derived hunks only. Unrelated edits in current Markdown survive. */
export function repairImportedBody(current:string,legacy:string,corrected:string){
  const before=legacy.trim().split('\n'),after=corrected.trim().split('\n'),lines=current.trim().split('\n');
  type Edit={from:number;to:number;currentFrom:number;currentTo:number;replacement:string[]};
  function alignment(target:string[]){
    const map=new Map<number,number>(),edits:Edit[]=[];let base=0,index=0,pending:Edit|undefined;
    const flush=()=>{if(pending){pending.to=base;pending.currentTo=index;edits.push(pending);pending=undefined;}};
    for(const part of diffArrays(before,target)){
      if(!part.added&&!part.removed){flush();for(let i=0;i<part.value.length;i++)map.set(base++,index++);}
      else {pending||={from:base,to:base,currentFrom:index,currentTo:index,replacement:[]};if(part.removed)base+=part.value.length;else{pending.replacement.push(...part.value);index+=part.value.length;}}
    }flush();return{map,edits};
  }
  const ours=alignment(lines),theirs=alignment(after),conflicts:number[]=[],changes:{from:number;to:number;replacement:string[]}[]=[];
  const equal=(a:string[],b:string[])=>a.length===b.length&&a.every((v,i)=>v===b[i]);
  for(const edit of theirs.edits){
    const overlap=ours.edits.filter(o=>o.from===o.to?o.from>=edit.from&&o.from<=edit.to:edit.from===edit.to?edit.from>=o.from&&edit.from<=o.to:o.from<edit.to&&o.to>edit.from);
    if(overlap.length){if(overlap.length===1&&overlap[0].from===edit.from&&overlap[0].to===edit.to&&equal(overlap[0].replacement,edit.replacement))continue;conflicts.push(edit.from+1);continue;}
    const from=edit.from===before.length?lines.length:ours.map.get(edit.from);
    if(from===undefined){conflicts.push(edit.from+1);continue;}
    let contiguous=true;for(let n=edit.from;n<edit.to;n++)if(ours.map.get(n)!==from+n-edit.from)contiguous=false;
    if(!contiguous){conflicts.push(edit.from+1);continue;}
    changes.push({from,to:from+edit.to-edit.from,replacement:edit.replacement});
  }
  for(const change of changes.toSorted((a,b)=>b.from-a.from))lines.splice(change.from,change.to-change.from,...change.replacement);
  return {body:changes.length?lines.join('\n')+'\n':current,changed:changes.length>0,conflicts};
}
