import type {EditorState} from '@milkdown/kit/prose/state';
export function imageCaptionTransaction(state:EditorState,position:number,caption:string){
  const image=state.doc.nodeAt(position);
  return image?.type.name==='image'?state.tr.setNodeMarkup(position,undefined,{...image.attrs,caption}):null;
}
