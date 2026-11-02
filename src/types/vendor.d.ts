declare module '@wordpress/block-serialization-default-parser' {
  export interface Block { blockName: string | null; attrs: Record<string, any>; innerBlocks: Block[]; innerHTML: string; innerContent: (string | null)[] }
  export function parse(input: string): Block[];
}
declare module 'turndown-plugin-gfm' { export const gfm: any; }
