# 纸上谈网 文档索引

纸上谈网（PaperNet）是面向初中课堂的网络拓扑与通信推演工具。教师机生成设备，学生用浏览器领取 PC、交换机、路由器或网络分流器，在课桌上连线，再按跳观察报文。

**目标用户**: 初中信息技术教师与学生。

**核心价值**:
- 教师权威课堂：定员、开领、暂停、结束、解除绑定
- 学生浏览器上课，Windows 教室只需教师电脑跑一个程序
- 聊天、ping、模拟帧都走教师机实时判断

当前版本：`0.1.0`。远程仓库：https://github.com/MorningSun-Hu/papernet

## 文档导航

- [架构设计](./ARCHITECTURE.md)
- [接口定义](./INTERFACES.md)
- [开发指南](./DEVELOPER_GUIDE.md)

## 专有概念

- [课堂与领取](./专有概念/课堂与领取.md)
- [在线与可达](./专有概念/在线与可达.md)
- [网络分流器](./专有概念/网络分流器.md)
- [教室部署](./专有概念/教室部署.md)

## 模块

- [教师机](./模块/teacher.md)
- [学生机 crate](./模块/student.md)
- [共享协议](./模块/shared.md)
- [Web 界面](./模块/web.md)
- [部署产物](./模块/deploy.md)

## 冻结与修订文档

实施以 `.monkeycode/specs/2026-09-19-classroom-network-sim/requirements.md` 为准。V1.2 冻结：`docs/01-SRS.md`、`docs/02-接口设计.md`、`docs/03-数据设计.md`、`docs/04-后端开发实施规划.md`、同目录 `design.md` / `tasklist.md`。

落地后的界面修订写在 `docs/08-前端修订记录.md`。教室发布步骤写在 `docs/09-发布与部署说明.md`。目录说明见 `docs/README.md`。
