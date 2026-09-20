# 纸上谈网 PaperNet

纸上谈网网络推演模拟系统（PaperNet Tabletop Network Simulation System）。

面向初中课堂的网络拓扑与通信推演教学工具：教师机生成设备，学生机随机领取 PC、交换机、路由器或特殊双口交换机，在课桌上拼成一张网，再按跳观察报文怎么走。

远程仓库：https://github.com/MorningSun-Hu/papernet

## 仓库结构

```
crates/shared     共享模型与课堂协议
crates/teacher    教师机（Rust）
crates/student    学生机（Rust）
web/teacher       教师 Web UI
web/student       学生 Web UI
assets/icons      设备矢量图标
docs              开发说明
.monkeycode/specs 需求与后续设计文档
```

需求文档：`.monkeycode/specs/2026-09-19-classroom-network-sim/requirements.md`

## 技术约定

- 教师机、学生机用 Rust，界面用 Web。
- Cargo workspace 管理三个 crate：`papernet-shared`、`papernet-teacher`、`papernet-student`。
- 教师 Web 作为课堂入口；学生 API 经前端反向代理转到教师机。

## 构建

```bash
# 编译工作区
cargo build
```
