# Web 界面模块

两个 Vite 应用共享 `web/shared/`。

| 路径 | 端口 | base |
| --- | --- | --- |
| `web/teacher` | 5174 | `/teacher/` |
| `web/student` | 5173 | `/student/` |

开发服务器把 `/api`、`/ws` 反代到 `127.0.0.1:8080`，`allowedHosts` 含 `.monkeycode-ai.online`。

`web/shared/claim.ts`：加入、领取屏、WS 事件（含 `classroom.online` 刷新 `pcHosts`）。
`web/shared/topo.ts`：教师/学生拓扑增量。
`web/student/src/stage.ts`：设备工作台。
`web/teacher/src/canvas.ts`：教师拓扑画布。

编产物：`bash scripts/build-web.sh` → `dist/teacher`、`dist/student`。运行时照片在 `assets/models/`。
