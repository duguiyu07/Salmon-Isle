/** Bounded process memory only; no rendered article history is written to disk. */
export class RenderCache<T>{
  private entries=new Map<string,{promise:Promise<T>;bytes:number}>();
  private bytes=0;
  constructor(private maxEntries=64,private maxBytes=8*1024*1024){}
  get(key:string,render:()=>Promise<T>,size:(value:T)=>number):Promise<T>{
    const cached=this.entries.get(key);
    if(cached){this.entries.delete(key);this.entries.set(key,cached);return cached.promise;}
    const entry={promise:null! as Promise<T>,bytes:0};
    entry.promise=Promise.resolve().then(render).then(value=>{
      if(this.entries.get(key)===entry){entry.bytes=size(value);this.bytes+=entry.bytes;
        if(entry.bytes>this.maxBytes)this.remove(key);
        this.trim();
      }
      return value;
    },error=>{if(this.entries.get(key)===entry)this.remove(key);throw error;});
    this.entries.set(key,entry);this.trim();return entry.promise;
  }
  private remove(key:string){const entry=this.entries.get(key);if(entry){this.bytes-=entry.bytes;this.entries.delete(key);}}
  private trim(){while(this.entries.size>this.maxEntries||this.bytes>this.maxBytes)this.remove(this.entries.keys().next().value!);}
}
