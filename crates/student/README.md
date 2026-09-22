# papernet-student

独立学生端：一个进程一个角色。采集本机 NIC 单播 MAC，向教师机 `join`，并维持 WebSocket 心跳。本阶段不打开 UI。

环境变量：

- `PAPERNET_TEACHER_URL` 默认 `http://127.0.0.1:8080`
- `PAPERNET_NIC_MAC` 覆盖本机采集的 MAC
- `PAPERNET_CONNECTION_ID` 断线后携带原连接重连
