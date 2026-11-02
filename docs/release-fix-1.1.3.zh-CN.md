# 1.1.3 Desktop 打包修复

任务：<https://github.com/duguiyu07/Salmon-Isle/actions/runs/41472679334/job/125372585145>。

本次三个失败项都发生在调用系统 tar 生成站点数据包时，原来的错误信息没有退出码，无法判断系统程序具体失败原因。
数据包和服务器配置包现改用直接声明的 Node `tar` 库生成，不再调用系统 tar。
相关部署测试也使用 Node 库读取归档；另加一个清空 PATH 后仍可打包及解压中文、空格文件名的回归用例。
归档仍为标准 `.tar.gz`，服务器解压和恢复命令不变。

修复同步到 `E:\projects\salmon-isle-v2\publish-workspace`，版本统一为 **1.1.3**。
在 PowerShell 中执行，每步成功后再继续：

```powershell
cd E:\projects\salmon-isle-v2\publish-workspace
git add --all
git commit -m "Fix Windows deployment archive creation"
git push origin main
git tag v1.1.3
git push origin v1.1.3
```

新任务将从修复后的提交运行。保留原有 `v1.1.2` 标签及镜像，不重写历史。
新的服务器镜像为 `ghcr.io/duguiyu07/salmon-isle:1.1.3`。
本次只验证打包相关测试和发布文件生成；完整 Windows 发布结果以新 CI 任务为准。
