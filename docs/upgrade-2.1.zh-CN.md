# 升级到 Salmon Isle 2.1

2.1 回归网站管理。保留现有文章、草稿、页面地址、权限、媒体、回收站和备份，不需要重新导入网站数据。升级后停止使用旧桌面客户端；旧同步接口返回 410。

## 更新网站

在当前 Docker 部署目录，先使用本 Release 服务器包中的升级脚本，再执行：

```sh
sh scripts/update-site.sh --image ghcr.io/duguiyu07/salmon-isle:2.1.0
```

Windows Docker 主机：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/update-site.ps1 -Image ghcr.io/duguiyu07/salmon-isle:2.1.0
```

脚本会准备镜像、停止写入、备份 data，再执行启动和健康检查；失败时恢复旧数据与旧镜像。保留部署目录的 backups/program-*。源码部署使用 Node.js 24，运行 npm ci、npm run build 后启动网站。

## 使用离线镜像升级

如果服务器拉取 GitHub 镜像很慢，上传本次提供的离线镜像包和校验文件，并将服务器包中的升级脚本放到原部署目录的 scripts/。先在镜像文件所在目录执行：

```sh
sha256sum -c Salmon-Isle-Image-2.1.0-linux-amd64.tar.gz.sha256
docker load -i Salmon-Isle-Image-2.1.0-linux-amd64.tar.gz
```

然后回到原网站部署目录执行：

```sh
sh scripts/update-site.sh --image ghcr.io/duguiyu07/salmon-isle:2.1.0 --local
```

`--local` 先检查已导入镜像，启动时使用 `--pull never`，整个更新过程不会拉取镜像。Windows 使用 `scripts/update-site.ps1 -Image ghcr.io/duguiyu07/salmon-isle:2.1.0 -Local`。仍会先备份原数据并在失败时回退。离线包用于 Linux x86_64／amd64，不用于 ARM 服务器。

## 使用网站后台

在 /admin/login 使用原管理密码登录。文章自动保存编辑稿，发布／更新后才改变公开正文。断网时当前浏览器保留未保存恢复稿，不提供完整离线应用。不同标签页的恢复稿独立保存；版本冲突时保留输入，重新载入后处理。

批量发布包含最新保存编辑稿；其他标签页未保存的输入不包含在内。移动与改权限立即生效，正文编辑稿继续保留。批量密码保护会给所选文章设置同一个新密码。

前台 Index 默认按创建时间倒序收录非 MISC 文章；草稿和私密内容不公开。后台“最近修改”按正式文章与编辑稿的最新修改时间排序。

## 恢复与回退

整站备份仍可恢复到空目录，原 1.x 数据在首次运行时沿用已有安全迁移流程。回退时停止写入，使用升级前备份和原镜像；先导出或备份升级后新增内容。旧同步表与迁移备份可保留用于历史恢复，不会重新启用桌面写入。
