# 需求实施计划

顺序约定：先完成后端 P0–P5 且全部功能测试通过，再进入前端设计开发。

冻结：2026-09-20 用户确认。未经授权不得改任务切分与阶段基线；完成勾选除外。

- [x] 1. P0 工程、课堂骨架与通道（后端）
  - 依据：`docs/04` §7、接口 §3.1 §3.4 §7、R16
  - 阶段基线：`GET /api/v1/health` 返回 200；`POST /api/v1/classrooms` 返回 `classroom_id`；本期不生成 `join_code`；WS 连上后收到 `hello`
  - [x] 1.1 补齐 workspace 依赖，teacher 默认监听 8080
    - 修改 `Cargo.toml`、`crates/teacher`
    - 不把交叉编译 linker 写入仓库 `.cargo/config.toml`
  - [x] 1.2 实现 `GET /api/v1/health` 与 `POST /api/v1/classrooms`
    - 请求体含 title 与 inventory；响应只含 `classroom_id` 等，无课堂码
    - 课堂对象进内存，`claim_state=draft`
  - [x] 1.3 实现 `/ws` 升级、下行 `hello`、上行 `heartbeat`
    - 查询参数 `classroom_id`、`connection_id`
  - [x] 1.4 实现 SQLite 空库与 `classroom` 表快照写入
    - 对应数据设计 §5.1 §6；connection 不落盘
  - [x] 1.5 编写 P0 功能测试：创建课堂返回 `classroom_id`；无 join_code；WS 收到 `hello`；ID 生成
    - 对应 `docs/04` §7.4 §7.5

- [x] 2. 检查点 P0 - 确保所有测试通过,如有疑问请询问用户
  - 验收：health 200；创建课堂有 `classroom_id`、无 `join_code`；`cargo test -p papernet-shared` 与 P0 HTTP/WS 测试通过
  - 未通过则停在 P0

- [ ] 3. P1 定员、领取与满员（后端）
  - 依据：SRS §3、接口 §3.2 §3.3、数据 §5.2 §5.8、R1 R2 R17；正确性 1、2、10
  - 阶段基线：`docs/04` §8.3 五条自动化测试全部通过
  - [ ] 3.1 按 inventory 生成 device/port，端口编号 `R1/01`、`S3/01`
    - 教师预置路由器口 IP 写入 port
  - [ ] 3.2 实现 `POST /api/v1/classrooms/join`（仅 `client_kind`，无 join_code）
    - draft → `waiting_open` 文案「请等待教师确定本课设备」
    - open 有空位 → 随机 `claimed`；无空位 → `full`，文案精确「本课设备已领完，请看教师屏」
    - waiting/claimed 创建 connection；full 不建长期 connection
  - [ ] 3.3 实现 `POST /api/v1/classrooms/{id}/open-claim`
    - 对已 waiting 连接立即随机发放或 `claim.full` 后结束连接
  - [ ] 3.4 独立端 join 接受 `nic_mac`；托管端生成真实格式单播 MAC
    - 对应 R2 AC6 AC7
  - [ ] 3.5 断线不释放已领角色；同 `connection_id` 重连恢复原 `device_id`
    - 仅教师结束课堂后角色池释放；教师机重启清空领取绑定
  - [ ] 3.6 编写 P1 功能测试（需求覆盖）
    - 未 open 得 waiting_open
    - 2 个 PC 定员，第 3 个 join 文案精确等于「本课设备已领完，请看教师屏」
    - 两连接不会领到同一 device_id
    - 先 waiting 再 open-claim 变为 claimed
    - claimed 断线后同 connection_id 仍为原 device_id
    - 同一 device_id 同时只被一条 connection 领取（正确性 1）

- [ ] 4. 检查点 P1 - 确保所有测试通过,如有疑问请询问用户
  - 验收：§8.3 五条全绿；满员文案一字不差；无课堂码逻辑

- [ ] 5. P2 端口、链路、表项（后端）
  - 依据：SRS §4 §5、接口 §4、数据 §5.3–5.7 §7、R3 R4 R5 R6 R14；正确性 3、4、5、9
  - 阶段基线：表项规则单测全绿；样例课堂一次配置后 WS 增量小于 4KB
  - [ ] 5.1 实现 `PUT /api/v1/devices/{id}/ports/{port_id}`
    - ip / peer_port_id / gateway；掩码恒 `255.255.255.0`，请求改掩码返回 `MASK_FIXED`
    - 仅本角色可写，否则 `NOT_OWNER`
  - [ ] 5.2 实现互指判定与 `physically_up`
    - 两端互指才连通；仅一端填写则未连通并保留配置
  - [ ] 5.3 连通后立即物化 MAC 表与 ARP 表
    - 交换机只有 MAC 表；PC/路由器只有 ARP 表
    - 同网段已配 IP、PC 网关 ARP 规则按数据设计 §5.6 §5.7
  - [ ] 5.4 广播 `topology.updated` 增量；实现 `GET /api/v1/classrooms/{id}/snapshot`（仅教师）
  - [ ] 5.5 实现 TAP `attach` 与 `GET /api/v1/ports/peers`
    - 对端候选不含 TAP 端口；TAP 串已连通链路
  - [ ] 5.6 编写 P2 功能测试（需求覆盖）
    - 仅一端填对端，physically_up=false
    - 互指后交换机 MAC 表有对端 MAC
    - PC 填网关且链路通，ARP 含网关
    - 对端候选不含 TAP 端口
    - physically_up 当且仅当两端互指（正确性 3）
    - 掩码恒为 255.255.255.0（正确性 5）

- [ ] 6. 检查点 P2 - 确保所有测试通过,如有疑问请询问用户
  - 验收：`docs/04` §9.2 四条全绿；增量小于 4KB；接口验收第 3 条

- [ ] 7. P3 可达性、普通模式 chat 与 ping（后端）
  - 依据：SRS §6、接口 §5、数据 §8、R7 R8 R9；正确性 6
  - 阶段基线：可达性纯函数覆盖同网段、跨网段、断链路；课堂场景四条 HTTP 测试通过
  - [ ] 7.1 在 `papernet-shared` 实现可达性
    - 同网段沿交换机与 TAP 物理链路 BFS
    - 跨网段：PC 网关等于通往目的网段的路由器近端口 IP，且沿途物理连通、地址配齐
  - [ ] 7.2 实现 `POST /api/v1/chat`
    - 仅 kind=pc；可达推送 `chat.sent` / `chat.received`；不可达 `UNREACHABLE`
    - 模拟模式拒绝，`NEED_NORMAL`
  - [ ] 7.3 实现 `POST /api/v1/ping`
    - 仅 PC、路由器；返回可达虚拟响应或失败信息
  - [ ] 7.4 编写课堂场景 PCA—S1—R1—S2—PCB 功能测试
    - 网关正确 chat 投递
    - PCA 网关填错 ping 失败
    - 同网段两 PC 经交换机可达
    - 路由器调用 chat 返回错误
    - 跨网段网关必要条件（正确性 6）

- [ ] 8. 检查点 P3 - 确保所有测试通过,如有疑问请询问用户
  - 验收：`docs/04` §10.2 四条全绿；接口验收第 4、7 条

- [ ] 9. P4 模拟模式、选口、改 MAC 与 TAP 记帧（后端）
  - 依据：SRS §7、接口 §6 §7、R10–R15；正确性 7、8、9
  - 阶段基线：`docs/04` §11.2 四条自动化通过；正确转发后本机 `frame.departed` 清空展示
  - [ ] 9.1 实现模式切换 `POST /api/v1/classrooms/{id}/mode` 并广播 `mode.changed`
  - [ ] 9.2 实现 PC 组帧 `sim/send`：按 ARP 填 MAC，汉字原文，推送 `frame.built` 并投递下一跳
  - [ ] 9.3 实现交换机/路由器 `forward`
    - 交换机按目的 MAC 对口；路由器按目的 IP 对口
    - 错口 `WRONG_PORT`，`at_device_id` 不变
    - 路由器对口后改写 dst_mac/src_mac，IP 与汉字不变
  - [ ] 9.4 实现 TAP 自动转发与 `tap_log`、`frame.logged`
  - [ ] 9.5 支持多 `frame_id` 并行；目的 PC `frame.arrived` 可投递；回复走同一套组帧逐跳
  - [ ] 9.6 编写 P4 功能测试（需求覆盖）
    - 交换机错口：帧仍在本机，WRONG_PORT
    - 路由器对口：下一跳 dst_mac 为 PCB MAC，src_mac 为 R1/02 MAC
    - TAP 日志条数等于经过次数
    - 回复帧能走回源 PC
    - 选错口帧位置不变（正确性 7）
    - 路由器改写 MAC 且 IP/汉字不变（正确性 8）

- [ ] 10. 检查点 P4 - 确保所有测试通过,如有疑问请询问用户
  - 验收：§11.2 四条全绿；接口验收第 5、6 条

- [ ] 11. P5 独立学生端协议、Nginx 与容量冒烟（后端）
  - 依据：SRS §8、R16 R17 R18、`docs/04` §12
  - 阶段基线：100 条 WS 同时在线且教师快照可开；10 路 chat 或 4 路模拟传帧时服务可响应；冒烟用临时目录
  - [ ] 11.1 实现独立学生端协议：采集本机 NIC MAC、join、维持 WS
    - `crates/student`；一个进程一个角色；本阶段不拉 UI
  - [ ] 11.2 编写 Nginx 样例配置：`/teacher/` `/student/` `/api/` `/ws`
  - [ ] 11.3 编写 100 条 WS 心跳冒烟脚本（临时目录）
  - [ ] 11.4 编写 10 路 chat 与 4 路模拟传帧的容量功能测试

- [ ] 12. 检查点 P5 后端总体验收 - 确保所有测试通过,如有疑问请询问用户
  - 后端总体验收（接口 §9.4 + 规划各阶段基线）：
    - 未 open-claim 加入得到 waiting_open
    - 先 waiting 再 open-claim 得到 claim.granted 或 claim.full
    - 领完再加入得到 full 与固定文案
    - 互指后双方表项立即出现在 snapshot 与 topology.updated
    - 缺网关跨网段 chat/ping 为 UNREACHABLE
    - 模拟选错口帧仍在，选对口下一跳收到 frame.arrived
    - chat 仅 PC
    - 课堂场景 PCA—S1—R—S2—PCB 普通模式互通、模拟模式可逐跳往返
    - 无课堂码
    - 100 连接心跳冒烟通过
  - 本检查点未通过则不开始前端

- [ ] 13. 前端设计开发（后端第 12 项通过后才开始）
  - 依据：R1–R15 界面条款、R16、SRS §2 §8
  - 阶段基线：教师与四类学生角色可完成目标课堂场景的配置、普通通信与模拟传帧
  - [ ] 13.1 教师 Web：定员、开放领取、拓扑、TAP 放置、模式切换、快照与增量
  - [ ] 13.2 学生 Web：等待/满员文案、按 kind 切换 PC/交换机/路由器/TAP
  - [ ] 13.3 PC：网卡图标、IP/网关/对端、对话窗口、ping、模拟组帧展示（帧头与数据区）
  - [ ] 13.4 交换机：端口、MAC 表、模拟选口；路由器：每口 IP、ARP、ping、模拟选口
  - [ ] 13.5 TAP：两端口展示、过路帧列表；对端枚举不含 TAP 口
  - [ ] 13.6 托管静态资源与开发反代 `/api`、`/ws`；独立端拉起学生 UI
  - [ ] 13.7 编写前端功能测试，覆盖 R1–R15 界面条款与目标课堂场景

- [ ] 14. 检查点 前端 - 确保所有测试通过,如有疑问请询问用户
  - 验收：目标课堂场景可在教师屏与学生屏走通；独立端与托管端共用角色池
