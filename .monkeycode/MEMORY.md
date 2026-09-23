# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry
User instruction entries should follow this format:

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry
Entries discovered by the Agent during task execution should follow this format:

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy
- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[协作启动]
- Date: 2026-09-20
- Context: 用户要求把通用开发记忆写入本仓库；每次压缩会话、启动开发前都先阅读
- Instructions:
  - 每次新对话、上下文压缩、任务阶段切换、启动开发前，先读取项目 `.monkeycode/MEMORY.md`
  - 只做用户当前明确要求的范围，不擅自扩大改动
  - 回复与思考过程使用简体中文
  - 发现可复用的操作/构建/排障/协作约定时，写入 MEMORY；实现细节留在代码和需求文档里

[Git 身份与提交授权]
- Date: 2026-09-19
- Context: 用户要求所有仓库统一身份，且提交必须先授权
- Instructions:
  - 提交身份固定为 `huchenyang <hcy_1987@163.com>`
  - 用 `git -c user.name='huchenyang' -c user.email='hcy_1987@163.com'` 覆盖当次提交，不修改仓库 `git config`
  - 提交前必须取得用户明确授权（例如「提交」「授权提交」）
  - 推送必须另有明确授权（例如「推送」）；「提交」不包含推送
  - 提交前检查 `git status`、`git diff`、`git log`，只暂存本次相关文件
  - 不提交密钥、真实 API Key、`.env` 真值、以及 `target/`、`dist/`、`node_modules/` 等可重建产物
  - 不 amend、不 force push，除非用户明确要求
  - 提交说明使用约定式前缀：`feat` / `fix` / `chore` / `docs` / `refactor`

[删除规定]
- Date: 2026-09-19
- Context: 清理构建缓存与过时静态资源时形成的安全删除流程
- Instructions:
  - 删除前必须列出完整路径，并核对：是否 gitignore、是否被当前入口文件引用、删除后能否重建
  - 必须等待用户明确确认后再删除
  - 只删除确认清单内的项，不顺带清理未列出的文件
  - 已跟踪文件删除会使工作区变脏，要入库时必须再次取得提交授权
  - 磁盘不足时优先列出可重建缓存（编译 `target`、前端 `dist`、旧哈希静态文件），确认后再清

[文档驱动开发]
- Date: 2026-09-19
- Context: 文档化开发阶段的通用流程
- Instructions:
- 编码前先读需求文档、任务拆解、模块路线图
- 每个开发阶段开始前先写执行基线文档，编码、联调、验收以该基线为准
- 用户要求先做需求分析、目录规划时，先出文档，再开始业务编码
- 实施与验收以冻结的 `requirements.md` 为准，见条目「需求文档冻结」

[需求文档冻结]
- Date: 2026-09-20
- Context: 用户确认 `.monkeycode/specs/2026-09-19-classroom-network-sim/requirements.md` 为已对齐需求，作为实施依据
- Instructions:
  - 该 `requirements.md` 已冻结
  - 实施、设计、编码、联调、验收以该文件为准
  - 未经用户授权或未经用户明确要求，不得修改该文件

[设计文档冻结]
- Date: 2026-09-20
- Context: 用户确认全部设计文档冻结（含去掉参考文档「不做」项、课堂码本期不实施之后的 V1.2）
- Category: Workflow & Collaboration
- Instructions:
  - 已冻结：`docs/01-SRS.md`、`docs/02-接口设计.md`、`docs/03-数据设计.md`、`docs/04-后端开发实施规划.md`、`.monkeycode/specs/2026-09-19-classroom-network-sim/design.md`（当前 V1.2）、`.monkeycode/specs/2026-09-19-classroom-network-sim/tasklist.md`
  - 未经用户授权或未经用户明确要求，不得修改上述文件
  - 与 `requirements.md` 冲突时以 `requirements.md` 为准，只改设计、不改冻结需求
  - 课堂码本期不实施；学生加入当前唯一课堂，不生成、不校验 `join_code`
  - 已领角色不因断线或心跳超时释放；waiting 连接在 open-claim 后立即领取

[实施顺序]
- Date: 2026-09-20
- Context: 用户确认任务切分后的开发顺序与测试要求
- Category: Workflow & Collaboration
- Instructions:
  - 先后端 P0–P5 完全调通且功能测试通过，再进入前端设计开发
  - 功能性测试必须全部做，保证需求 100% 实现
  - 任务与阶段基线：`.monkeycode/specs/2026-09-19-classroom-network-sim/tasklist.md`
  - 按阶段建 git 分支；P1 在 `P1`，P2 在 `P2`

[构建与交叉编译]
 - Date: 2026-09-21
 - Context: 小磁盘环境与多平台编译中的通用做法
 - Instructions:
   - 长编译、打包用受管后台终端，设置合理超时与 CPU 限制，避免把磁盘写满
   - 交叉编译用环境变量指定 linker（例如 `CARGO_TARGET_*_LINKER`），不在仓库写死会污染其他平台构建的 `.cargo/config.toml`
   - Windows 批处理使用 CRLF；避免 `if (...) else (...)` 块结构，改用 `goto`
   - `cargo test` 不会更新运行用二进制；改完入口后需先 `cargo build` 再启动验证
   - 受管后台终端跑 cargo 时 PATH 可能不含 `/root/.cargo/bin`，使用绝对路径 `/root/.cargo/bin/cargo`

[预览与本地验证]
- Date: 2026-09-19
- Context: 预览服务与冒烟测试约定
- Instructions:
  - 用户要求停止预览或服务时立即停止对应进程
  - 冒烟测试使用独立数据文件或临时目录，避免覆盖用户本机数据
  - 前后端分离时，预览入口走前端开发服务器，并把 `/api` 反代到后端

[密钥隔离]
- Date: 2026-09-19
- Context: Agent 环境与用户项目凭据必须分开
- Instructions:
  - 不扫描、不读取、不输出、不写入执行环境中的大模型 API Key
  - 用户项目使用项目自己的环境变量名和占位符，由用户自行填入真实值

[apply_patch 标记格式]
- Date: 2026-09-19
- Context: 用户要求定位 missing Begin/End markers 并记住，避免再犯
- Instructions:
  - apply_patch 的 `patchText` 必须以整行 `*** Begin Patch` 开头、整行 `*** End Patch` 结尾
  - 这两行必须精确匹配：行首无空格、行尾无多余 `***`、无引号、无代码围栏包裹
  - 错误写法 `*** Begin Patch ***` / `*** End Patch ***` 会报 `Invalid patch format: missing Begin/End markers`
  - 报错 `Failed to find context` 是定位上下文与文件内容对不上，和 Begin/End 标记无关；先读文件，用 `@@` 后跟文件中真实存在的一行来定位
  - 不要写 unified diff 的行号头（例如 `@@ -64,6 +64,19 @@`），该工具会把这串当成要查找的上下文
  - 新建文件用 `*** Add File: <path>`，后续每行内容必须以 `+` 开头

[远程仓库]
- Date: 2026-09-20
- Context: 用户建好 GitHub 仓库并要求绑定；凭据文件不得放在仓库内
- Category: Operations & Deployment
- Instructions:
  - 远程仓库：`https://github.com/MorningSun-Hu/papernet.git`
  - 本地 `origin` 已指向该地址
  - 本环境已用 GitHub CLI 登录账号 `MorningSun-Hu`（`/root/.config/gh/hosts.yml` 与 `~/.git-credentials`）
  - 仓库根目录不放置 token 文件；用户交来的登录文件已移出仓库，到 `/root/.config/papernet/github-token.txt`（权限 600），仅在 gh 登录失效时再用来重登
  - `.gitignore` 仍忽略 `授权登录Github.txt`，防止再次放回仓库被提交

[设备图标素材]
- Date: 2026-09-22
- Context: 用户要求学生端按 PNG 手绘轻量 SVG；教师端后传思科图标
- Category: Workflow & Collaboration
- Instructions:
  - 设备原图目录：`assets/icons/source/`
  - 学生端运行时只用 `assets/icons/*.svg` 轻量手绘矢量，对照 `source/` PNG 绘制
  - 禁止使用 `source/` 里体积过大的参考 SVG
  - 教师端思科图标待用户后传；未到前用逻辑几何 SVG 占位
