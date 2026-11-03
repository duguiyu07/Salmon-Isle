# 1.1.0 可视化连接与覆盖更新

日常使用优先按照 [可视化连接与程序更新](visual-setup-and-updates.md) 操作：在线后台和桌面端均有仓库连接入口，无需手动编辑 Git 连接环境变量或运行迁移命令。下面保留命令行迁移、SSH 和自定义部署方式。

# 桌面写作与 Git 内容同步

Windows 桌面端与在线后台共用编辑器、内容格式和样式。源码可以公开；内容仓库应保持私有，因为它包含草稿、私密内容、媒体和访问密码散列。

## 使用流程

1. 在桌面端的“待提交”页面连接私有内容仓库，选择空的本地目录，默认分支为 `main`，填写网站地址。HTTPS 使用 Git Credential Manager，SSH 使用电脑上的密钥或 SSH 代理。不要在仓库 URL 中填写密码或令牌。
2. 编辑文章、HTML/CSS 页面、文件夹或媒体。保存与每 60 秒自动保存只写入本地工作区；关闭窗口会先尝试保存，异常退出时也保留浏览器恢复稿。
3. 使用“准备发布”“准备更新”或“准备撤回”决定正式内容的目标状态；仍未发布的编辑稿也可以提交备份。
4. 打开“待提交”，检查文件和 diff，点击“提交并推送全部改动”。提交信息可以留空。一次提交生成一个 commit，首版不提供逐文件或逐行暂存。
5. “已推送待同步”表示远程已收到提交；只有“网站已同步”才表示网站已切换到该版本。桌面端离线时仍可编辑、预览和保存。首次连接和推送需要网络。

推送失败时保留已有 commit，重试只推送该提交。此后继续输入的改动留待下一次提交。两端同时修改时先拉取合并；冲突页面可以查看共同基线、本地修改和远程更新，选择一侧或手动合并。正式内容更新而编辑稿仍基于旧版本时，也必须合并编辑稿。系统不强制推送、不改写已经公开的历史；检测到远程历史重写时停止同步。

“媒体库”支持独立上传、筛选、引用查看和移入回收站。在编辑器中插图有“媒体库／上传／URL”三种来源，粘贴图片仍可直接上传。选取旧媒体会生成当前文档的附件鉴权地址。外链只保存 URL，不下载到仓库，离线时可能不可用。被正文、封面、HTML/CSS、编辑稿或回收站引用的媒体不能删除，先在相应内容中解除引用。

## 从现有数据迁移

先停止所有写入，在当前网站数据目录的服务器上执行。迁移不会覆盖原数据，不会自动推送远程。

```powershell
# 默认仅预检；目标必须是独立目录，不能使用源码目录或原 data/content。
npm run migrate:git -- --target E:\salmon-content

# 自动完整备份原数据，再复制内容和媒体、导出媒体元数据并创建初始提交。
npm run migrate:git -- --target E:\salmon-content --apply

git -C E:\salmon-content remote add origin git@github.com:your-account/private-content.git
git -C E:\salmon-content push -u origin main
```

默认备份输出到当前目录的 `backups/before-git-*.zip`。再次对已经迁移的目标执行迁移只校验并报告，不覆盖后续编辑。原始历史版本保留在旧数据和备份中；Git 提交历史从迁移的初始提交开始。

内容仓库包含 `content`、`editor-drafts`、`media`、`media-meta`、`trash` 和版本标记 `library.json`。文章仍使用已有 frontmatter，页面 HTML/CSS 保留原格式，文件夹使用 `.folder.yml`。媒体文件使用稳定 ID，每个资源对应一个 JSON 元数据文件。不要向内容仓库提交网站设置、SQLite、会话、管理员密码、密钥或 `.env`；服务器会拒绝非内容文件、符号链接、子模块、路径冲突和自定义 Git 过滤器。

## 网站配置

不启用内容仓库时，现有在线后台与原 `data` 格式继续工作。启用前完成迁移和远程初始推送。部署后，在线后台也使用准备发布与统一提交的流程，网站设置保存仍然立即生效。

```dotenv
SALMON_DATA_DIR=/data
SALMON_CONTENT_REPO_DIR=/data/library
SALMON_CONTENT_REMOTE=git@github.com:your-account/private-content.git
SALMON_CONTENT_BRANCH=main
SALMON_SYNC_INTERVAL_MS=30000
```

`SALMON_DATA_DIR` 保存网站设置、认证、Git 同步状态与上线快照；`SALMON_CONTENT_REPO_DIR` 是独立的可写内容工作区，Docker 中应位于持久化卷内。使用上述配置前，把已迁移的仓库放到工作区目录；也可以先在空目录克隆同一远程分支。

网站启动后立即检查远程，之后默认每 30 秒检查一次；在线提交后立即同步。后台工作区和访客使用的上线版本分开。候选版本需要通过路由、目录、权限、媒体及引用校验，并重建索引后才切换。失败继续服务上一版本，在“待提交”显示原因。设置引用的目录被删除时，需要先在在线设置中调整目录。管理员可使用 `/admin/preview/<文章ID>` 预览工作区，公开地址始终读取上线快照。

后台检查不会自动改写已经打开的编辑工作区，包括尚未来得及自动保存的输入。收到远程更新会显示待合并提示；先保存当前编辑，再点击“拉取并合并”或在提交时合并。首次连接的空工作区会自动载入远程内容。

容器已包含 Git、OpenSSH 与 CA 证书。双向编辑要求服务器拥有仓库写权限。SSH 部署密钥和 `known_hosts` 通过部署环境挂载，例如 Compose override：

```yaml
services:
  blog:
    volumes:
      - ./deploy-secrets/ssh:/home/node/.ssh:ro
```

将该目录及文件设置为容器 `node` 用户可读，私钥权限为 `0600`，并预先配置主机公钥校验。HTTPS 部署通过 Git 凭据助手提供凭据，不把令牌嵌入 URL。源码仓库忽略 `deploy-secrets/`。

`GET /api/health` 的 `contentRevision` 是当前上线 commit SHA；未切换到 Git 快照时为 `null`。详细同步错误、历史、diff 和媒体引用接口仍要求管理员登录。

## 备份与恢复

停止写入后使用原备份命令。启用 Git 时，备份同时包含仓库历史、未提交工作区、恢复 stash、当前上线快照与网站运行数据，不包含 Git Credential Manager 中的凭据或外部 SSH 密钥。恢复到空目录会把连接配置中的工作区改为恢复目录下的 `content-repository`。如使用环境变量指定工作区，也要同步调整 `SALMON_CONTENT_REPO_DIR`。重新配置仓库凭据后启动服务。

迁移回退时停止服务，取消内容仓库环境变量和运行目录中的 `library-connection.json` 配置，再指向原始数据或迁移前备份；后续在 Git 中产生的改动不会自动写回旧数据目录。

## 从源码构建桌面端

需要 Node.js 24 和 Windows x64 构建环境。运行时不需要用户另行安装 Node.js 或 Git。

```powershell
npm ci
npm run desktop:install
npm run desktop:package
```

产物位于 `dist/desktop`，包括安装程序和 ZIP 包；安装不删除用户内容。构建只装入 standalone 程序、公共字体/品牌资源和内置 Git，不包含本机实际内容或凭据。没有签名证书时生成未签名安装包；公开分发前可按 electron-builder 文档配置 Windows 代码签名。

如果 GitHub 二进制下载不可达，可以通过 `ELECTRON_MIRROR` 配置可用镜像；保留 Electron 官方包自带的校验。Dugite 内置 Git 也必须通过其 `embedded-git.json` 中的 SHA-256 校验，不能跳过校验。下载配置属于构建机器环境，不写入产品连接配置。

验证命令：

```powershell
npm run check
npm test
npm run build
npm run test:http
npm run test:git-http
npm run test:standalone
npm run desktop:prepare
npm run desktop:smoke
# 验证真正打包后的程序，而非源码启动器：
npm run desktop:smoke -- --executable "dist/desktop/win-unpacked/Salmon Isle Writer.exe" --no-system-tools
```

桌面测试使用独立 `.qa-artifacts` 数据目录、临时 Git 远程仓库和隐藏窗口，检查服务令牌、静态资源、实际编辑器与三种图片来源、编辑稿保存、Git 提交及媒体选择截图。
