# 共享协议模块

Crate：`papernet-shared`。`crates/shared/src/lib.rs` 导出课堂 ID、连接 ID、帧 ID、MAC 生成，以及文案常量 `MSG_WAITING_OPEN`、`MSG_CLASSROOM_FULL`。

| 文件 | 职责 |
| --- | --- |
| `topo.rs` | 链路、ARP/MAC 表重建、端口物理状态、C 类网判断 |
| `reach.rs` | 可达 |
| `frame.rs` | 模拟帧 MAC 改写、交换机/路由器出端口 |

教师机与（如使用）学生 crate 都依赖本库。Web 端有一份平行的 TypeScript 模型在 `web/shared/`。
