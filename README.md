# 纸上谈网 PaperNet

纸上谈网网络推演模拟系统（PaperNet Tabletop Network Simulation System）。

面向初中课堂的网络拓扑与通信推演教学工具：教师机生成设备，学生用浏览器领取 PC、交换机、路由器或网络分流器，在课桌上拼成一张网，再按跳观察报文怎么走。

远程仓库：https://github.com/MorningSun-Hu/papernet

## 仓库结构

```
crates/shared      共享模型与课堂协议
crates/teacher     教师机（Rust）
crates/student     Linux 无界面学生客户端
web/teacher        教师页
web/student        学生页
web/shared         领取与拓扑
assets/models      运行时设备照片
docs               设计与修订记录
deploy             Nginx、systemd、本地运行包
scripts            编页、预览、Windows 打包
.monkeycode/specs  需求与设计
.monkeycode/docs   项目 wiki
```

需求：`.monkeycode/specs/2026-09-19-classroom-network-sim/requirements.md`

Wiki：`.monkeycode/docs/INDEX.md`

## 技术约定

- 教师机用 Rust，课堂界面用 Web。
- Cargo workspace：`papernet-shared`、`papernet-teacher`、`papernet-student`。
- 教室服务器：教师机本机 80 只提供接口，Nginx 8080 托管页面并反代 `/api` `/ws`。

## 构建

```bash
cargo build
bash scripts/build-web.sh
```

教室 Linux 包与 Windows 包步骤见 `docs/09-发布与部署说明.md`。

当前版本：0.1.0
