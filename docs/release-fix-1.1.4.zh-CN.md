# 1.1.4 Electron 运行文件安装修复

失败任务：<https://github.com/duguiyu07/Salmon-Isle/actions/runs/41477784015/job/125389695679>。

Electron 45 改为首次运行时按需下载二进制文件，npm ci 只安装 JavaScript 包。
项目使用 electronDist 指定 `desktop/node_modules/electron/dist`，因此打包前必须显式准备该目录。
官方说明：<https://www.electronjs.org/docs/latest/tutorial/installation#binary-download-step>。

本次修改：

- `npm run desktop:install` 安装依赖后运行已锁定 Electron 包的官方 `install.js`。
- `package` 和 `package:dir` 的前置脚本同样检查并准备运行文件，已有匹配版本时直接复用。
- CI 在 Next.js 构建前检查 Electron 版本及 `electron.exe` 是否存在；下载或解压失败会在安装步骤报告。
- 继续使用 Electron 包自带的下载及校验逻辑，不关闭校验，不改用未锁定版本。

修复同步到 `E:\projects\salmon-isle-v2\publish-workspace`，版本统一为 **1.1.4**。
随后已修正第 59 行的 YAML 引号问题，并增加源码打包前的完整 workflow YAML 检查。
本次只修复工作流语法，版本继续保持 1.1.4。在 PowerShell 中执行：

```powershell
cd E:\projects\salmon-isle-v2\publish-workspace
git add --all
git commit -m "Fix workflow YAML quoting and validate source workflows"
git push origin main
```

提交成功后，打开仓库 **Actions → Release desktop and website → Run workflow**，分支选择 **main**，再点击 Run workflow。
这里使用 main 上修正后的工作流，不创建新标签，也不重跑旧提交的失败任务。
新任务的 Desktop 阶段应先出现 `Electron runtime ready: 45.2.1`，然后进入构建。
保留已存在的标签及镜像；本次不改变网站数据。
