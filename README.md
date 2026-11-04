# Salmon Isle

许可协议：GPL-3.0-only

当前版本为 **2.2.1**。直接在网站 `/admin` 中写作、管理文章与页面、上传媒体、导入 WordPress 和备份数据。程序发布于 <https://github.com/duguiyu07/Salmon-Isle>。

草稿自动保存到网站，点击“发布／更新”后才上线。浏览器保留未保存内容的恢复稿，多标签页各自独立。后台跳转支持中键打开新标签页，文章支持批量移动、改权限、发布和撤回。

2.1 停用桌面客户端与跨端同步，旧客户端不能继续写入网站。升级请阅读 [2.2 升级指南](docs/upgrade-2.2.zh-CN.md)。

## 本地启动

需要 Node.js **24 LTS**。依赖使用 `package-lock.json` 锁定。

```powershell
npm ci
npm run setup
npm run dev
```

打开 http://127.0.0.1:3000 。第一次进入 `/admin/login`，使用 `npm run setup` 获取令牌，设置至少 12 位的管理密码。

生产方式运行：

```powershell
npm run build
npm start
```

所有运行内容默认存放在 `data/`，可通过 `SALMON_DATA_DIR` 设置绝对目录。



## HTML 动态组件

在自定义页面中可使用动态组件：

```html
<div data-page-slot="home-posts"></div>
<div data-page-slot="archive"></div>
<div data-page-slot="collection"></div>
```

分别对应首页文章、归档目录与文章集合。

## 扩展 Markdown 语法

对组、折叠、标签的支持：

````md
:::group{preset="purple" radius="3px" padding="15px"}
**参考资料**

[链接](https://example.com)
:::

::::details{title="查看详细步骤" open="true"}
:::group{preset="yellow"}
嵌套容器的外层使用更多冒号。
:::
::::

::::tabs
:::tab{title="C"}
```c
int main(void) { return 0; }
```
:::
:::tab{title="Java"}
Java 内容。
:::
::::
````



## 2.2 编辑与缓存

行内文字颜色与荧光背景可在工具栏中设置，也可使用：

```md
:text[重点 **内容**]{color="red" background="yellow"}
:text[自定义配色]{color="#3478ce" background="#ffee58"}
```

文字预设：`red orange green blue purple gray`；背景预设：`yellow green cyan blue purple pink`。自定义颜色接受 HEX，自动适配日间与深色模式。

页面编辑器使用 HTML、CSS、预览三个标签，支持图片、文章列表、归档、集合和链接卡片。导入、导出与备份集中在设置中的“导入／导出”。归档文件夹切换支持客户端导航。

字体分片和带内容指纹的内置图片使用浏览器长期缓存。文章图片先验证访问权限，再通过 ETag / Last-Modified 复用缓存；新的字体分片仍按需首次加载。
