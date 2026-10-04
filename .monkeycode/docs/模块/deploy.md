# 部署产物模块

已入库：

- `deploy/nginx.conf`
- `deploy/papernet.service`
- `deploy/Ubuntu-26.04-Nginx部署教程.html`

本地、gitignore：

- `deploy/runtime/`：Linux `papernet-teacher` 与静态页
- `deploy/windows/`：exe、dll、bat、静态页

`nginx.conf`：`listen 8080`，`root /var/www/papernet`，`/api/` `/ws` 反代 `127.0.0.1:80`。
`papernet.service`：默认 `User=ubuntu`，`PAPERNET_BIND=127.0.0.1:80`，`PAPERNET_UI_DIR=`。

脚本：`scripts/build-web.sh`、`scripts/preview-static.sh`、`scripts/pack-windows.sh`。

说明：`docs/09-发布与部署说明.md`。
