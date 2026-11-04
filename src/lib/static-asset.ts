const hashes:Record<string,string>=JSON.parse(process.env.NEXT_PUBLIC_STATIC_ASSET_HASHES||'{}');
/** The configured URL stays editable; built-in assets get a content-versioned browser cache key. */
export function staticAsset(url:string){return hashes[url]?`${url}?v=${hashes[url]}`:url;}
