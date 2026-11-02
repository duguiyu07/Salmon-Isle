export function isHtmlBlock(node:{lang?:string|null;meta?:string|null}) {
  return node.lang?.toLowerCase()==='html'&&node.meta?.trim()==='render';
}
/** Choose a fence longer than any backtick run in the author's HTML. */
export function htmlBlockMarkdown(source:string) {
  const longest=Math.max(0,...Array.from(source.matchAll(/`+/g),match=>match[0].length));
  const fence='`'.repeat(Math.max(3,longest+1));
  return `${fence}html render\n${source}\n${fence}`;
}
