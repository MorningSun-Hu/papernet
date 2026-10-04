# 接口定义

权威设计原文在冻结文件 `docs/02-接口设计.md`。下面按当前 `crates/teacher/src/lib.rs` 列出已实现路由。

统一前缀：`/api/v1`。成功体带 `ok` 与 `data`。WebSocket 路径：`/ws`。

教室入口上，浏览器只访问 8080：页面由 Nginx 提供，`/api/` 与 `/ws` 反代到 `127.0.0.1:80`。

## HTTP

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/v1/health` | 健康检查，`{"data":{"status":"up"},"ok":true}` |
| POST | `/api/v1/classrooms` | 创建课堂（定员） |
| POST | `/api/v1/classrooms/join` | 学生加入并领取 |
| GET | `/api/v1/classrooms/current` | 教师恢复当前课堂 |
| POST | `/api/v1/classrooms/{id}/open-claim` | 开领 |
| POST | `/api/v1/classrooms/{id}/pause-claim` | 暂停领取 |
| GET | `/api/v1/classrooms/{id}/snapshot` | 课堂快照 |
| POST | `/api/v1/classrooms/{id}/end` | 结束课堂 |
| POST | `/api/v1/classrooms/{id}/taps/{tap_id}/attach` | 分流器旁路挂接 |
| POST | `/api/v1/classrooms/{id}/devices/{device_id}/unbind` | 解除绑定 |
| PUT | `/api/v1/devices/{device_id}/ports/{*port_id}` | 写端口 IP/掩码/网关/对端 |
| GET | `/api/v1/ports/peers` | 可连端口 |
| POST | `/api/v1/chat` | 聊天 |
| POST | `/api/v1/ping` | ping，教师机实时判断 |
| POST | `/api/v1/classrooms/{id}/mode` | 切换推演模式 |
| POST | `/api/v1/sim/send` | 发送模拟帧 |
| POST | `/api/v1/sim/frames/{frame_id}/forward` | 按跳转发 |

## WebSocket

升级：`GET /ws`。课堂与连接标识走查询或头：`X-Classroom-Id`、`X-Connection-Id`、`X-Client-Kind`。

前端已处理的事件（`web/shared/claim.ts`、`web/shared/topo.ts`、`web/teacher/src/main.ts`）：

| 事件 | 作用 |
| --- | --- |
| `hello` | 进入后的课堂状态 |
| `classroom.online` | 在线人数；含 `pc_hosts` 数组 |
| `claim.granted` / `claim.released` / `claim.full` | 领取变化 |
| `classroom.ended` | 课堂结束 |
| `topology.updated` | 拓扑 |
| `mode.changed` | 模式 |
| `chat.sent` / `chat.received` | 聊天 |
| `frame.built` / `frame.arrived` / `frame.repack` / `frame.departed` / `frame.logged` | 模拟帧 |

领取变化时 `emit_online` 广播当前 `pc_hosts`，已领取学生用它刷新「在线 PC」。

## 静态路径

| 路径 | 教室 Nginx | 教师机自托管 |
| --- | --- | --- |
| `/teacher/` | `root /var/www/papernet` | `PAPERNET_UI_DIR/teacher` |
| `/student/` | 同上 | `PAPERNET_UI_DIR/student` |
| `/` | 无首页 | 无首页 |

无斜杠的 `/teacher`、`/student` 由 Nginx 301 到带斜杠路径。

## 环境变量

| 变量 | 默认 | 含义 |
| --- | --- | --- |
| `PAPERNET_BIND` | `0.0.0.0:8080` | 监听地址 |
| `PAPERNET_DATA_DIR` | `data` | SQLite 目录 |
| `PAPERNET_UI_DIR` | 空则探测 cwd/exe 旁 | 静态页根；空字符串表示不托管页面 |

教室服务：`PAPERNET_BIND=127.0.0.1:80`，`PAPERNET_UI_DIR=`。
