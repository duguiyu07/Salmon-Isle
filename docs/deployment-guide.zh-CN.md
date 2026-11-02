# Salmon Isle 上线与开源操作指南

本指南适用于 OpenCloudOS 9、2 核 2G、宝塔 Nginx 和 `https://salmon-isle.com`。
程序在 GitHub Actions 上构建，服务器拉取镜像运行，无需安装宿主机 Node.js、MySQL 或编译项目。

代码仓库：<https://github.com/duguiyu07/Salmon-Isle>；代码许可：GPL-3.0-only。
后续程序更新从该仓库 Releases 获取。网站文章与运行数据独立保存，首次上线不需要创建内容 Git 仓库。

## 0. 先认识交付文件

交付目录为项目下的 `dist/deployment/`。

| 路径 | 用途 | 是否可以公开 |
| --- | --- | --- |
| `public/Salmon-Isle-Source-1.1.2.zip` | 上传到 GitHub 的完整源码 | 可以 |
| `public/Salmon-Isle-Server-1.1.2.tar.gz` | 服务器 Compose、环境模板、反代配置及维护脚本 | 可以 |
| `public/SHA256SUMS.txt` | 公开交付物校验值 | 可以 |
| `操作指南.md` | 本指南的副本 | 可以 |
| `private/migration-report.json` | 最近一次文章与资源迁移报告 | 不可以 |
| `private/missing-media.txt` | 需要补齐的图片/附件相对路径 | 不可以 |
| `private/Salmon-Isle-Data-*.tar.gz` | 真正上线所需的站点数据包 | 不可以 |
| `private/runs/` | 原数据备份、隔离迁移副本和历次报告 | 不可以 |

**必须看到 `private/migration-report.json` 中 `ready: true`，才能使用该报告 `archive` 指向的数据包。**
报告为 `ready: false` 时不会生成本次最终数据包。旧的其他数据包不能代替本次验收结果。
私有包包含草稿、受密码保护的文章和管理员密码散列，只通过 SSH 或宝塔私有文件管理传输。

## 1. Windows：补齐媒体并准备站点数据

### 1.1 从旧 WordPress 取得最新 uploads

在宝塔文件管理里进入旧站的 `wp-content/uploads`，将**整个 uploads 目录**打包下载。
解压到本项目的 `deploy-input/uploads`，让目录结构直接类似：

```text
deploy-input/uploads/2026/10/图片.png
```

不要多嵌套一层 `uploads/uploads`。目录已被 Git 和 Docker 忽略。
旧站备份中已知存在缺失图片，尤其涉及两篇已发布的数据结构文章；完整性以准备命令的报告为准。
仍缺少的旧图片需要从原电脑、旧站备份或历史媒体目录补齐。不要先停用旧站再查找文件。

### 1.2 停止本地写入并运行准备命令

先停止本项目正在运行的开发服务（对应终端按 Ctrl+C），关闭正在编辑此数据的窗口。
准备命令创建原始备份后，在独立副本中导入，不覆盖原来的 `data/`。

打开 PowerShell：

```powershell
Set-Location 'E:\projects\salmon-isle-v2'
$project = (Get-Location).Path
$delivery = Join-Path $project 'dist\deployment'
node --version
```

建议使用 Node.js 24.22.1（与发布构建一致）。如果依赖尚未安装，运行 `npm ci`。
按下面的单行命令执行，XML 默认位于当前 Windows 账户的 Downloads：

```powershell
npm run prepare:deployment -- --xml "$env:USERPROFILE\Downloads\salmonisle.WordPress.2026-11-02.xml" --media-dir 'deploy-input/uploads' --reference-xml '原网站内容/salmonisle.WordPress.2026-10-31.xml'
```

如果文件放在其他位置，只替换对应路径。
`--reference-xml` 只提供新附件未包含的分类层级和主题配置，旧 XML 的文章和页面不会被重新导入。
原始两个 XML 都不被修改，也不放进公开源码包。

```powershell
$report = Get-Content -LiteralPath "$delivery\private\migration-report.json" -Raw | ConvertFrom-Json
$report.ready
$report.articles
$report.pages
Get-Content -LiteralPath "$delivery\private\missing-media.txt"
```

预期结果：`ready` 为 `True`，活动文章 36 篇，其中已发布 16 篇、草稿 20 篇；附件中的 1 篇回收站文章留在回收站。
`pages.unchanged` 为 `True`，页面为 `/`、`/about`、`/knowledge`、`/misc`、`/links`。
导入保留已有管理员配置和站点设置。回收站中的历史页面可以继续保留，不进入前台。
`conversionWarnings` 是区块转换提示，需核对复杂内容；资源或一致性错误会阻止生成数据包。

若退出码为 2：查看 `missing-media.txt` 和报告的 `errors`，补齐后重新运行同一命令。
每次运行使用独立副本和文件名，不会清空上次备份。

### 1.3 重新生成公开交付文件

```powershell
npm run release:deployment
Get-FileHash -Algorithm SHA256 -LiteralPath "$delivery\public\Salmon-Isle-Source-1.1.2.zip"
Get-FileHash -Algorithm SHA256 -LiteralPath "$delivery\public\Salmon-Isle-Server-1.1.2.tar.gz"
```

本步骤不需要私人数据齐全，可以先完成公开源码发布。

## 2. Windows：上传到现有 GitHub 仓库

目标仓库已有 `main` 分支和 README。以下方法先克隆仓库，再提交源码，保留原来的提交历史。
无需在原项目根目录执行 `git init`，也不要强制推送。

安装 Git for Windows 后，在同一个 PowerShell 窗口执行：

```powershell
$publish = Join-Path $project 'publish-workspace'
git clone https://github.com/duguiyu07/Salmon-Isle.git "$publish"
if ($LASTEXITCODE -ne 0) { throw '克隆失败，请先解决 GitHub 网络或登录问题' }
$unpacked = Join-Path $delivery 'source-unpacked'
Expand-Archive -LiteralPath "$delivery\public\Salmon-Isle-Source-1.1.2.zip" -DestinationPath $unpacked -Force
$source = Join-Path $unpacked 'Salmon-Isle-Source-1.1.2'
Get-ChildItem -LiteralPath $source -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $publish -Recurse -Force }
Set-Location -LiteralPath $publish
git status --short
```

首次使用 Git 可能需要配置提交身份。邮箱请使用 GitHub「Settings → Emails」页面提供的提交邮箱：

```powershell
git config user.name 'duguiyu07'
# 将下一行的占位内容替换为你的 GitHub 提交邮箱后再执行。
git config user.email '你的GitHub提交邮箱'
```

确认目录里没有 `data`、`private`、XML、数据库、`.env` 或备份后：

```powershell
git add --all
git diff --cached --stat
git commit -m 'Release Salmon Isle 1.1.2 with deployment guide'
if ($LASTEXITCODE -ne 0) { throw '提交失败，请查看上面的原因' }
git push origin main
if ($LASTEXITCODE -ne 0) { throw '推送失败，请完成 GitHub 登录后重试' }
```

HTTPS 推送出现浏览器授权时，登录 `duguiyu07` 并授权 Git Credential Manager。
如果仓库后来出现新提交，先检查 `git status`，再 `git pull --rebase origin main`、解决冲突并重试正常推送。
不要上传整个 `dist/deployment`，不要将私有数据包作为 Release 附件。

## 3. GitHub：发布 1.1.2

1. 打开仓库的 **Actions**，允许仓库运行工作流（若页面要求）。
2. 检查 **Settings → Actions → General → Workflow permissions**，允许工作流写入仓库及包。
3. 在本地发布目录推送版本标签：

```powershell
git tag v1.1.2
git push origin v1.1.2
```

4. 在 Actions 等待 `verify`、`website`、`desktop` 全部完成。
5. 打开 Releases，确认 `v1.1.2` 中有安装程序、ZIP、blockmap、`latest.yml`、`release.json`、源码包、服务器配置包和校验文件。
6. 在 GitHub 账户的 **Packages → salmon-isle → Package settings → Change visibility** 将容器包设为 **Public**。
   GitHub 源码公开与容器包公开是两个设置；首次发布的包可能仍是私有的。

镜像应为 `ghcr.io/duguiyu07/salmon-isle:1.1.2`。
打开以下地址应能下载 JSON：

<https://github.com/duguiyu07/Salmon-Isle/releases/latest/download/release.json>

未配置 Windows 签名证书时产生未签名安装包；网站镜像发布不需要证书。
已有签名证书时再配置 `WINDOWS_CSC_LINK`、`WINDOWS_CSC_KEY_PASSWORD` 和 `WINDOWS_PUBLISHER_NAME`。

若标签已存在，不删除线上标签来重发；先检查现有 Release，后续版本同时更新根目录与 desktop 的版本和锁文件，再发布新标签。

## 4. 宝塔与服务器：准备运行环境

在宝塔中安装或确认 Nginx 和 Docker。已有 Docker 时不要重复安装另一套。
服务器终端执行以下只读检查：

```sh
cat /etc/os-release
uname -m
free -h
df -h /opt
docker version
docker compose version
ss -lntp | grep ':3000 ' || true
```

首版镜像为 Linux amd64，`uname -m` 应为 `x86_64`。若是 `aarch64`，需要另行构建 ARM64 镜像后部署。
Compose 需支持 `up --wait`（建议 2.20 或以上版本）。若没有 Compose，在宝塔 Docker 管理页面补装/更新插件。
不要在这台 2G 服务器上执行 `npm run build` 或 `docker compose build`。

沿用当前域名时，如果域名已经解析到这台服务器，就无需修改 DNS。
如更换服务器，只将域名 A 记录指向新服务器；没有配置 IPv6 时清理指向旧主机的 AAAA 记录。
云安全组和系统防火墙保持网站需要的 80、443 可访问，SSH/宝塔管理端口按你现有规则保留。
3000 仅绑定回环地址，不用向公网开放。

在切换前，通过宝塔备份旧 WordPress 文件、数据库、站点 Nginx 配置、SSL 配置与证书。
新程序放 `/opt/salmon-isle`，不要覆盖旧站的 `/www/wwwroot/...`。

## 5. Windows：上传服务器配置与私人数据

先重新进入原项目并读取最终通过的报告。将下面的 `服务器公网IP` 替换为实际 IP：

```powershell
Set-Location -LiteralPath $project
$serverHost = 'root@服务器公网IP'
$report = Get-Content -LiteralPath "$delivery\private\migration-report.json" -Raw | ConvertFrom-Json
if (-not $report.ready -or -not (Test-Path -LiteralPath $report.archive)) { throw '数据尚未准备完成' }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $report.archive).Hash.ToLowerInvariant() -ne $report.sha256) { throw '数据包校验失败' }
[IO.File]::WriteAllText((Join-Path $delivery 'private\site-data.sha256'), "$($report.sha256)  site-data.tar.gz`n", [Text.Encoding]::ASCII)
ssh $serverHost 'install -d -m 700 /opt/salmon-isle/incoming'
scp "$delivery\public\Salmon-Isle-Server-1.1.2.tar.gz" "$delivery\public\SHA256SUMS.txt" "${serverHost}:/opt/salmon-isle/incoming/"
scp "$($report.archive)" "${serverHost}:/opt/salmon-isle/incoming/site-data.tar.gz"
scp "$delivery\private\site-data.sha256" "${serverHost}:/opt/salmon-isle/incoming/"
```

也可以用宝塔文件管理上传这些文件到同一目录。不要放在网站公开根目录。

## 6. 服务器终端：解压、拉取、启动

以下命令适用于首次部署的空目录，由 root 执行：

```sh
cd /opt/salmon-isle/incoming
sha256sum -c --ignore-missing SHA256SUMS.txt
sha256sum -c site-data.sha256
cd /opt/salmon-isle
tar -xzf incoming/Salmon-Isle-Server-1.1.2.tar.gz
test ! -e data && test ! -e .env
```

只有最后一条成功（退出码 0）才继续。如果已有 `data` 或 `.env`，先判断是否已有部署，不覆盖解压。

```sh
tar -xzf incoming/site-data.tar.gz
cp .env.example .env
chmod 600 .env
chown -R 1000:1000 data
chmod 700 data
install -d -m 700 backups
docker compose config --quiet
docker compose pull blog
docker compose up -d --no-build --wait --wait-timeout 120 blog
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health
```

环境模板已经设置 HTTPS 域名、程序版本及更新地址。管理员使用原本地后台的密码，不存在默认密码。
`data` 挂载带 `:Z`，为 OpenCloudOS 的 SELinux 提供独立容器标签；不要通过关闭 SELinux 解决数据权限问题。
先检查 `docker compose logs --tail=100 blog` 和 `ls -ldZ data`，确认 UID 1000 可读写。

此时旧 WordPress 仍可继续提供域名访问，新站在服务器回环地址测试。

```sh
curl -fsS -H 'Host: salmon-isle.com' http://127.0.0.1:3000/ -o /dev/null
curl -fsS -H 'Host: salmon-isle.com' http://127.0.0.1:3000/knowledge -o /dev/null
docker stats --no-stream
```

## 7. 宝塔：切换域名到新程序

1. 在「网站」中打开 `salmon-isle.com` 的设置，先保存完整原配置副本。
2. 保留已有 `listen`、域名、SSL 证书和 ACME 验证相关配置。证书过期或缺失时先在宝塔申请/续签证书。
3. 清除旧 WordPress 伪静态/重写、PHP 路由和原来的 `location /`；移除会抢先处理图片、JS、CSS 的静态扩展名 location。
4. 将服务器 `/opt/salmon-isle/baota-proxy.conf` 的内容放入**现有 server 块内部**。
   已有 `client_max_body_size` 时修改其值，不重复添加。
5. 也可用「反向代理 → 添加」设置目标 `http://127.0.0.1:3000`、发送域名 `salmon-isle.com`，关闭缓存；再按模板核对请求头、缓冲和超时。
   两种配置方式任选一种，不要保留重复的代理规则。
6. 宝塔保存并测试 Nginx 配置，通过后重载。HTTPS 正常后启用 HTTP 跳转 HTTPS。

不将 `data` 映射为 Nginx 静态目录。不对文章、API、媒体、后台或搜索开启 CDN 页面缓存。
域名前若已有 CDN，先关闭这些路径的缓存并清理旧缓存再验收。

## 8. 浏览器与服务器：上线验收

使用浏览器无痕窗口访问：

- `https://salmon-isle.com/`、`/about`、`/knowledge`、`/misc`、`/links`：五个页面内容与布局正常。
- 任意公开文章及旧文章地址：正文、图片、代码块、数学公式正常；重点检查两篇数据结构文章。
- 密码文章：未输入密码看不到正文和受保护附件；输入正确密码后正常显示。
- `/search`、`/rss.xml`、`/sitemap.xml`：不泄露草稿和受保护正文。
- `/admin/login`：使用原管理员密码登录。后台核对已发布 16、草稿 20 以及 XML 对应回收站文章。
- 后台「更新」：默认发布源是本仓库；首次安装版本为 1.1.2 时显示当前版本。

服务器再执行：

```sh
curl -fsS https://salmon-isle.com/api/health
docker compose ps
docker stats --no-stream
docker compose logs --tail=50 blog
```

全部通过后停用旧 WordPress 的运行入口，保留旧文件、数据库及配置备份。
如切换后出现问题，先在宝塔恢复原 Nginx 配置即可切回旧站，再排查新容器；不要删除旧数据。

## 9. 后续程序更新

代码修改在发布工作区提交到同一仓库。发布新版本前，同时更新根目录和 desktop 的 `package.json` 及锁文件版本，推送对应的 `v版本` 标签，等待 Actions 成功。

网站后台右上角「更新 → 检查更新」从以下地址读取版本：

```text
https://github.com/duguiyu07/Salmon-Isle/releases/latest/download/release.json
```

后台会提供带具体版本的更新命令。在服务器 `/opt/salmon-isle` 执行，例如未来发布 1.1.3 后：

```sh
cd /opt/salmon-isle
sh scripts/update-site.sh --image ghcr.io/duguiyu07/salmon-isle:1.1.3
```

脚本先拉取新镜像，再停止写入并备份，保留原数据挂载，启动并等待健康检查。
失败时尝试恢复上一镜像，备份保留在 `backups/program-时间/`。首版不使用 `latest` 自动覆盖生产环境。
程序发布不会更新你的文章，也不会清空 `data`。

桌面客户端安装 Release 中的新版安装程序即可覆盖；新打包客户端已内置同一仓库的更新目录。
此前安装的旧包可在「更新源」中填写一次 `https://github.com/duguiyu07/Salmon-Isle/releases/latest/download/`。

## 10. 备份、恢复与回退

### 手动备份

```sh
cd /opt/salmon-isle
sh scripts/backup-site.sh
```

脚本短暂停止博客以取得一致数据包，完成后重新启动。将生成的私有备份下载到另一台设备。
日常可在宝塔计划任务中执行同一命令；频率按自己的写作频率设置。

### 恢复数据

先确认备份来源和 SHA-256。该脚本接受本指南生成的、内部以 `data/` 为根目录的 tar.gz：

```sh
cd /opt/salmon-isle
sh scripts/restore-site.sh /opt/salmon-isle/backups/manual-实际时间/data.tar.gz
```

恢复前的数据保留为 `backups/restore-时间/previous-data`。启动失败会尝试恢复原数据。
恢复历史版本时先确认程序版本与备份格式兼容。

### 更新失败后的人工回退

自动回退未成功时，查看更新脚本打印的备份目录，先停止服务。把 `.env` 的 `SALMON_WEB_IMAGE` 改回上一实际版本，再启动：

```sh
cd /opt/salmon-isle
docker compose stop blog
# 用编辑器把 .env 的镜像版本改回，例如 ghcr.io/duguiyu07/salmon-isle:1.1.2
docker compose up -d --no-build --wait --wait-timeout 120 blog
```

如需回到备份时的数据，再运行上面的恢复命令。不要清空 `data`，不要执行删除数据卷的命令。

## 11. 常见问题

| 现象 | 检查方法 |
| --- | --- |
| 拉取镜像提示 denied | 确认 Packages 中 `salmon-isle` 已设为 Public，标签已经发布 |
| 拉取超时 | 检查服务器访问 `ghcr.io` 的网络；必要时在其他 Linux amd64 Docker 主机拉取后用 `docker save` / `docker load` 离线传输，保持原镜像标签 |
| 启动端口冲突 | 检查 3000 的已有进程；不要停止不明服务。若改用别的回环端口，Compose 和 Nginx 目标端口一起改 |
| 502 | 先检查回环地址的 `/api/health`、容器日志和 Nginx 的目标端口；SELinux 拒绝连接时按系统审计记录调整 Nginx 的网络访问权限 |
| 页面能开但 JS、CSS 或图片 404 | 检查宝塔旧静态扩展名 location、WordPress 伪静态和 CDN 缓存 |
| 登录或保存提示来源不匹配 | 确认浏览器使用 `https://salmon-isle.com`，`.env` 的 SALMON_ORIGIN 一致，代理发送 Host 和 X-Forwarded-Proto |
| 内容为空 | 检查数据包已解压为 `/opt/salmon-isle/data/content`，容器正确挂载 `/data` |
| 权限错误 | 检查数据文件归属 UID 1000、目录读写权限与 SELinux 标签 |
| 更新源 404 | 确认 Actions 的 desktop 发布步骤成功，Release 已公开且含 `release.json` |

官方参考：[宝塔反向代理](https://docs.bt.cn/user-guide/site/php/site-config/reverse-proxy)、[GitHub 容器仓库](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)、[Docker 安装](https://docs.docker.com/engine/install/)。
