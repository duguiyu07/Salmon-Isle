/** Shared by the visible insert menu and the slash menu. */
export const editorInsertions=[
  {label:'内容组',key:'group',markdown:':::group{preset="outline" styleVersion="2"}\n内容\n:::'},
  {label:'折叠',key:'details',markdown:':::details{title="详细信息"}\n内容\n:::'},
  {label:'标签页',key:'tabs',markdown:'::::tabs\n:::tab{title="标签一"}\n内容\n:::\n:::tab{title="标签二"}\n内容\n:::\n::::'},
  {label:'分栏',key:'columns',markdown:'::::columns\n:::column\n第一列\n:::\n:::column\n第二列\n:::\n::::'},
  {label:'图库',key:'gallery',markdown:':::gallery\n\n:::'},
  {label:'代码',key:'code',markdown:'```text\n代码\n```'},
  {label:'HTML',key:'html',markdown:'```html render\n<div>\n  <p>自定义 HTML 内容</p>\n</div>\n```'},
  {label:'公式',key:'math',markdown:'$$\nx^2\n$$'},
  {label:'表格',key:'table',markdown:'| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |'},
  {label:'待办事项',key:'task',markdown:'- [ ] 待办事项'},
  {label:'引用',key:'quote',markdown:'> 引用内容'},
];
