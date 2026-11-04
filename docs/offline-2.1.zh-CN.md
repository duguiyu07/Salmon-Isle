# Salmon Isle 2.1.0 离线更新

适用：现有 Linux x86_64 / amd64 Docker 部署。镜像标签为 `ghcr.io/duguiyu07/salmon-isle:2.1.0`。

将离线更新 ZIP 包里的文件解压到现有网站部署目录（该目录中已有 compose.yml、.env 和 data/）。包内包含镜像、校验文件、升级脚本和说明；沿用原部署配置及数据目录。

在该部署目录执行：

```sh
sha256sum -c Salmon-Isle-Image-2.1.0-linux-amd64.tar.gz.sha256
docker load -i Salmon-Isle-Image-2.1.0-linux-amd64.tar.gz
sh scripts/update-site.sh --image ghcr.io/duguiyu07/salmon-isle:2.1.0 --local
```

升级脚本会先检查本地镜像、保存原镜像、停止写入并备份 data，再用 `--pull never` 启动新版本。整个流程不从 GitHub 拉取镜像。健康检查失败时恢复旧数据和原镜像。备份位于 `backups/program-*`。

完成后验证：

```sh
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health
```

进入 `/admin` 使用原管理密码登录。2.1 在网站中提供完整编辑管理，旧桌面同步接口已经停用。

镜像使用已验证的 Linux Node 24.22.1 基础层，加入本次 standalone 网站程序、Linux sharp 原生依赖和 CA 证书；不含站点文章或凭据。本地生产 HTTP、standalone、单元测试及镜像层摘要均已验证。本机没有可运行的 Linux Docker 引擎，未执行 docker load 和容器启动；服务器上的自动健康检查会完成运行环境验证。详细记录见验收报告。

完整功能和回退说明见 `Salmon-Isle-Upgrade-2.1.zh-CN.md`。

如果先前下载的更新脚本在第 2 行报 `set: invalid option`，是旧离线包中的 Windows 换行导致。该错误发生在升级操作开始前；在部署目录转换脚本换行后重试即可，无需重新导入镜像：

```sh
sed -i 's/\r$//' scripts/update-site.sh
sh scripts/update-site.sh --image ghcr.io/duguiyu07/salmon-isle:2.1.0 --local
```
