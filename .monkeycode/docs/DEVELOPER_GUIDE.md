# 开发指南

## 项目目的

纸上谈网让初中课堂用真实设备照片和端口热区推演以太网/IP 转发。教师机是唯一权威。

**核心职责**:
- 课堂生命周期与领取
- 拓扑、聊天、ping、模拟帧
- 编出 Linux/Windows 教室包

## 环境搭建

### 前置条件

- Rust（`/root/.cargo/bin/cargo`）
- Node.js（Vite 编静态页）
- Windows 包：`gcc-mingw-w64-x86-64`、`rustup target add x86_64-pc-windows-gnu`

### 开发运行

教师机默认 `0.0.0.0:8080`。Vite 教师页 `5174`、学生页 `5173`，把 `/api` `/ws` 反代到 `127.0.0.1:8080`。

```bash
/root/.cargo/bin/cargo run -p papernet-teacher

# 另开终端
cd web/teacher && npx vite
cd web/student && npx vite
```

静态页预览（少走 Vite）：

```bash
/root/.cargo/bin/cargo build --release -p papernet-teacher
bash scripts/build-web.sh
bash scripts/preview-static.sh
```

默认 `http://127.0.0.1:8088/teacher/` 与 `/student/`。

### 测试

```bash
/root/.cargo/bin/cargo test -p papernet-teacher
cd web/teacher && npm test
```

后端阶段测试在 `crates/teacher/tests/p0_classroom.rs` 到 `p5_capacity.rs`。前端检查脚本 `scripts/check-f0.mjs` 到 `check-f5.mjs`。

冒烟用独立数据目录，避免覆盖本机 `data/`。

## 常见任务

### 更新教室运行包

```bash
/root/.cargo/bin/cargo build --release -p papernet-teacher
bash scripts/build-web.sh
mkdir -p deploy/runtime
cp target/release/papernet-teacher deploy/runtime/papernet-teacher
cp -a dist/teacher deploy/runtime/teacher
cp -a dist/student deploy/runtime/student
```

Linux 包拷到服务器后：二进制进 `runtime/`，页面再拷到 `/var/www/papernet/`，然后 `systemctl restart papernet`。

### Windows 教室包

```bash
bash scripts/pack-windows.sh
```

产物 `deploy/windows/`（gitignore）。整夹拷到教师电脑，双击 `启动教室.bat`。exe 与旁边的 `student/` `teacher/` 一起换。

### 改接口或领取逻辑

1. 改 `crates/teacher/src/lib.rs` / `classroom.rs`
2. 补 `crates/teacher/tests/`
3. 前端事件在 `web/shared/claim.ts`
4. 界面修订追加 `docs/08-前端修订记录.md`
5. 不改 V1.2 冻结原文

## 编码与协作

- 分支：`YYMMDD-(feat|fix|chore|refactor)-xxxxx`
- 提交前用户授权；「提交」不含推送
- 身份：`git -c user.name='huchenyang' -c user.email='hcy_1987@163.com'`
- 不提交 `target/`、`dist/`、`deploy/runtime/`、`deploy/windows/`、密钥
- 删除文件前列完整路径并等待确认

## 冻结范围

未经授权不要改：

- `.monkeycode/specs/2026-09-19-classroom-network-sim/requirements.md`
- `docs/01-SRS.md` 到 `docs/04-后端开发实施规划.md`
- 同目录 `design.md`、`tasklist.md`
