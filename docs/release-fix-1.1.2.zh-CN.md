# 1.1.2 CI 修复与重新发布

适用于失败任务 <https://github.com/duguiyu07/Salmon-Isle/actions/runs/41439201947>。

## 本次修复

- 迁移时先检查目标工作区，再严格复制到尚不存在的内容目录，最后创建缺失的空目录及仓库元数据。保留 `errorOnExist: true`、`force: false`，已有内容目录会在任何写入前被拒绝。
- 桌面更新器统一使用根项目已经声明的 `yaml`；desktop 也直接声明 `yaml`，并更新锁文件，不依赖 electron-builder 间接提供的 `js-yaml`。
- Ubuntu 验证任务固定使用 Node 24.22.1，只执行根目录 `npm ci`，并在测试前单独加载桌面更新器，确认不依赖桌面安装目录。
- 桌面构建与 Docker 使用 Node 24.22.1。增加真实 YAML 发布者配置及迁移禁止覆盖的回归检查。
- 根项目、desktop、两个锁文件及生产镜像模板统一为 **1.1.2**。标签版本检查提前到安装依赖之前。

失败任务虽然由 `v1.1.1` 标签触发，但对应提交 `66443c5` 的 package.json 仍是 1.1.0。
因此不要重新运行旧任务，也不要删除或强制移动旧标签。新任务必须来自修复后的新提交和 `v1.1.2` 标签。

## 在现有发布工作区提交修复

本地修复会同步到 `E:\projects\salmon-isle-v2\publish-workspace`。
这是原来的 Git 工作区，已有 main 历史和 origin，保留了你修改过的 README。
如果从交付源码包恢复到其他电脑，先将 1.1.2 源码解压到该电脑的仓库克隆目录，再执行后面的步骤。

在 PowerShell 执行：

```powershell
Set-Location 'E:\projects\salmon-isle-v2\publish-workspace'
git status --short
git diff --stat
node scripts/check-release-version.mjs
```

最后应输出 `Release version verified: 1.1.2`。核对修改后提交：

```powershell
git add --all
git commit -m 'Fix clean CI install and migration for Node 24.22.1'
if ($LASTEXITCODE -ne 0) { throw '提交未成功，请先处理上述错误' }
git push origin main
if ($LASTEXITCODE -ne 0) { throw '推送未成功，请先完成登录或处理远程冲突' }
git tag v1.1.2
if ($LASTEXITCODE -ne 0) { throw '标签未创建，请检查该版本是否已存在' }
git push origin v1.1.2
```

不要使用 GitHub 页面上旧任务的 Re-run jobs；那会重新检出旧提交。
若 main 在你操作期间发生变化，先保留本地提交，再正常拉取、合并并检查版本；不要强制推送。

## 检查新任务

打开仓库 Actions，确认新任务对应 `v1.1.2` 和刚才的提交。

1. `verify` 应通过；它使用 Node 24.22.1 的 Ubuntu 干净环境，只有根目录依赖。
2. `website` 发布镜像 `ghcr.io/duguiyu07/salmon-isle:1.1.2`。
3. `desktop` 使用 Node 24.22.1 安装根目录及桌面依赖，生成安装程序与 Release。
4. Releases 的 `v1.1.2` 应包含 `release.json`、`latest.yml`、安装程序、源码包、服务器包及校验文件。

首次上线继续使用 [部署指南](deployment-guide.zh-CN.md)，其中镜像及文件名已更新为 1.1.2。
站点私人数据不随这次代码修复改变；原有数据包如果已通过媒体完整性检查，仍可用于部署。

## 本地干净安装验证的边界

本次会额外在项目目录之外创建空测试目录，用官方 Node 24.22.1 和锁文件执行根目录 `npm ci`，不复制任何已有 node_modules，也不安装 desktop 依赖。
本机操作系统为 Windows；Ubuntu 的最终结果以新提交触发的 verify 任务为准。
具体本地命令与结果记录在交付目录的 `verification-report.json`，不把 Windows 测试表述成 Linux 测试。
