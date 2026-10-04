# 教师机模块

Crate：`papernet-teacher`。入口 `crates/teacher/src/main.rs`，逻辑在 `lib.rs`。

`app()` 注册 HTTP 与 `/ws`。`run()` 读 `PAPERNET_BIND`、`PAPERNET_DATA_DIR`，打开 SQLite，必要时 `with_static_ui`。

`classroom.rs` 持有课堂内存态：设备、端口、连接、领取、模式。`db.rs` 把课堂、设备、端口、链路、分流器挂接写入 sqlite。

测试：`crates/teacher/tests/p0_classroom.rs` 到 `p5_capacity.rs`。静态页测试 `serves_teacher_and_student_static_pages`；领取广播 `join_pushes_classroom_online` 断言 `pc_hosts` 为数组。

教室部署时把 `PAPERNET_UI_DIR` 设为空，避免工作目录里的静态页被挂上，页面改由 Nginx 提供。
