# Salmon Isle

许可协议：GPL-3.0-only

源码与更新来自 <https://github.com/duguiyu07/Salmon-Isle>。当前待发布版本为 **1.1.2**；本次 CI 修复及重新发布步骤见 [发布修复指南](docs/release-fix-1.1.2.zh-CN.md)，服务器上线步骤见 [部署操作指南](docs/deployment-guide.zh-CN.md)。



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


