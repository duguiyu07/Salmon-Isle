# 1.1.4 容器运行数据锁文件修复

## 问题与源码修复

使用非 root 用户运行、数据挂载为 `/data` 时，旧程序尝试在挂载目录的同级创建 `/data.salmon-lock`。容器用户不能写入根目录，因此网站内容预检及旧格式内容写入会报 `EACCES`。给宿主机 `data/` 再次更改权限无法解决这个路径错误。

源码现在将运行数据目录的锁保存在目录内部，并在备份中排除临时锁。内容仓库工作区仍使用同级锁，保留空目录初始化及原子切换工作区的行为。源码改动尚未发布到 GHCR。

## 已部署镜像的临时修复

现有 `ghcr.io/duguiyu07/salmon-isle:1.1.4` 可以使用交付目录 `dist/deployment/runtime-lock-fix/` 中的 `runtime-lock.cjs`，无需重新下载镜像。该文件仅将旧运行数据锁的打开、读取、删除操作映射到 `/data/library-setup/runtime.salmon-lock`，保留独占创建行为；该控制目录已被现有备份和内容迁移流程排除。

1. 用宝塔文件管理创建 `/opt/salmon-isle/data/runtime-fixes/`，将 `runtime-lock.cjs` 上传至该目录。文件应可由 UID 1000 读取；通常目录 `755`、文件 `644` 即可。原数据根目录权限继续沿用现有设置。
2. 编辑服务器 `/opt/salmon-isle/compose.yml`，在 `blog` 服务已有的 `environment:` 下添加一项；如果已存在 `NODE_OPTIONS`，在其原值后追加这里的 `--require` 参数：

   ```yaml
         NODE_OPTIONS: "--require=/data/runtime-fixes/runtime-lock.cjs"
   ```

   例如：

   ```yaml
   services:
     blog:
       environment:
         SALMON_DATA_DIR: /data
         NODE_OPTIONS: "--require=/data/runtime-fixes/runtime-lock.cjs"
   ```

   这是已有配置的局部示意，继续保留原来的其他环境变量、数据挂载和 `127.0.0.1:3002:3000` 端口映射。

3. 在服务器终端重建此服务：

   ```sh
   cd /opt/salmon-isle
   docker compose config --quiet &&
   docker compose up -d --no-build --pull never --wait --wait-timeout 120 blog
   ```

4. 检查服务：

   ```sh
   curl -fsS http://127.0.0.1:3002/api/health
   docker compose logs --tail=50 blog
   ```

5. 返回在线后台「提交 → 仓库连接」，使用刚才已完成授权的正式内容仓库，重新点击「预检网站内容」。核对清单，再点击「备份并确认接入」，等待显示「网站已同步」。无需重新创建 GitHub App 或把测试客户端内容推送到正式仓库。

该补丁文件在 `data/runtime-fixes/` 内，随当前备份逻辑一起备份；锁文件位于被排除的控制目录内，不进入备份或内容仓库。移除 `NODE_OPTIONS` 中这个参数并重建 `blog` 即可停用补丁。以后升级到包含源码修复的新镜像时，再移除此参数。

## 桌面端重新连接

在网站完成迁移并显示「网站已同步」后，再连接桌面端：

- 仓库：同一个正式私有内容仓库的 HTTPS 地址。
- 网站：`https://salmon-isle.com`。
- 分支：与网站端一致，正式仓库使用 `main` 时填写 `main`。
- 本地目录：一个独立的空目录。本机已准备 `E:\projects\salmon-isle-v2\deploy-input\desktop-content`。

点击「连接并下载」。首次 GitHub 身份验证在系统浏览器中完成。后续编辑先保存，再在「提交」中核对变更并推送。
