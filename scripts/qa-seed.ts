import fs from 'node:fs';
import path from 'node:path';
import { saveArticle,saveFolder,saveSettings,getSettings } from '../src/lib/storage';
import { hashPassword } from '../src/lib/crypto';
import { dataDir,initDirs } from '../src/lib/paths';
import { addMedia,mediaUrl } from '../src/lib/media';
if(!dataDir().endsWith('.qa-data'))throw new Error('QA seed must target .qa-data');initDirs();
const blog=saveFolder({name:'博客'});const f=saveFolder({name:'后端技术栈',parentId:blog.id});const mysql=saveFolder({name:'MySQL',parentId:f.id});
const a=saveArticle({title:'[MySQL] 01 – MySQL 概述和 SQL 通用语法',status:'published',pinned:true,summary:'从数据库的基本概念开始，记录 MySQL 的安装、配置，以及 SQL 的通用语法。',folderId:mysql.id,body:`## 1.1 – 数据库相关概念

数据库是按照数据结构来组织、存储和管理数据的仓库。

## 1.2 – MySQL 安装和配置

### 一、安装、配置和启动

在官网下载 MySQL 安装文件（8.0.x 版）。

:::group{preset="purple"}
**MySQL Community Downloads**

[https://dev.mysql.com/downloads/](https://dev.mysql.com/downloads/)
:::

:::group{preset="purple"}
**MySQL Windows 10/11 安装 – 菜鸟教程**

[https://www.runoob.com/](https://www.runoob.com/)
:::

下载最新的社区版本后，一路点击下一步即可。

:::group{preset="outline"}
**启动和停止 MySQL：**

- 如果安装时没有特别设置，MySQL 会注册为 Windows 系统服务并开机自启。
- 使用 <code>net start/stop mysql80</code> 就可以启动、停止 MySQL 服务。
:::

### 二、客户端连接

:::details{title="方式一：命令行工具"}

~~~sql
SELECT title, created_at
FROM notes
WHERE published = true
ORDER BY created_at DESC;
~~~
:::

:::group{preset="yellow"}
**一个小提示**

把复杂的事情分解成几个简单的步骤，慢慢来。
:::

## 1.3 – 关系型数据库

使用二维表格描述数据之间的关系。记下一些概念，再通过实践把它们串联起来。

## 1.4 – SQL 通用语法和分类

| 类型 | 用途 |
| --- | --- |
| DDL | 定义数据结构 |
| DML | 操作数据 |

记下今天的发现，明天再继续。

行内公式 $x^2+y^2=r^2$。

$$
\\frac{a}{b}=c
$$

::::tabs
:::tab{title="第一项"}
第一项内容。
:::
:::tab{title="第二项"}
第二项内容。
:::
::::

::::columns
:::column
左栏内容。
:::
:::column
右栏内容。
:::
::::

<mark style="background-color:#ffee57">内联样式</mark>

:::future{key="preserve-me"}
未知容器内容。
:::
`});
const notes=saveFolder({name:'日常与随笔'});saveArticle({title:'把零散的思绪，安放在各自的位置',status:'published',folderId:notes.id,summary:'关于整理、记录，以及为什么想要一座属于自己的小岛。',body:'## 记录的意义\n\n不必每一次都写得完整。先留下来，再慢慢整理。'});
saveArticle({title:'[Git] 01 – 首次配置与基础操作',status:'published',folderId:f.id,summary:'从第一次提交开始，认识版本管理的日常。',body:'## 从这里开始\n\n```bash\ngit init\ngit add .\ngit commit -m "Hello, island"\n```'});
saveArticle({title:'一篇还在整理的笔记',folderId:notes.id,body:'还在慢慢整理。'});
const misc=saveFolder({name:'MISC'});saveFolder({name:'独立页面'});saveFolder({name:'未分类'});
for(let i=1;i<=11;i++){let post=saveArticle({title:`杂项记录 ${i}`,folderId:misc.id,status:'published',body:'杂项正文',summary:'一段杂项摘要。',createdAt:new Date(Date.UTC(2026,9,i)).toISOString()});if(i===11){const media=addMedia('cover.svg',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="500"><rect width="1200" height="500" fill="#c2bbc9"/><path d="M0 420 300 160 600 400 900 100 1200 420Z" fill="#60556e"/></svg>'),post.id);saveArticle({...post,cover:mediaUrl(media.id,post.id)});}}
saveArticle({title:'MISC',kind:'page',status:'published',aliases:['/misc'],template:'collection',collection:{folderId:misc.id,perPage:10},body:'# MISC\n\n*所有被归类为杂项的博客都在这里'});
saveArticle({title:'QA 私密文章',status:'published',folderId:mysql.id,access:'private',body:'PRIVATE'});
fs.writeFileSync(path.join(dataDir(),'admin.json'),JSON.stringify({hash:hashPassword('qa-only-password-2026')}),{mode:0o600});saveSettings({...getSettings(),knowledgeRootId:blog.id,giscus:{...getSettings().giscus,enabled:false}});console.log(JSON.stringify({articleId:a.id,url:`/posts/${a.id}`}));
