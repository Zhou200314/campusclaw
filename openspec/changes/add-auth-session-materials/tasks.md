# Tasks: add-auth-session-materials

> 约定：完成一项 → 执行该行 verify 并通过 → 勾选 `[x]` → 提交。

## §1 项目骨架与配置
- [x] 1.1 后端目录骨架 `backend/cmd/server` 等价结构 + `internal` 分模块 — verify: `node backend/src/server.js` 能启动并打印监听地址
- [x] 1.2 前端 React + TypeScript 骨架 — verify: `cd frontend && npm run build` 产出 `dist/index.html`
- [x] 1.3 配置全部来自环境变量，无硬编码密钥 — verify: 全局搜索有无默认口令与默认密钥常量
- [x] 1.4 缺配置即启动失败 — verify: 删除 `.env` 后启动，进程退出且提示缺少 `SESSION_SECRET`

## §2 数据层与种子
- [x] 2.1 建表：classes / users / sessions / login_attempts / materials — verify: 启动后检查数据库表结构
- [x] 2.2 双班种子数据 — verify: 查询 `classes` 得 2 行（高一(1)班、高一(2)班）
- [x] 2.3 两种角色、4 个账号 — verify: `teacher01/student01/teacher02/student02` 均可查
- [x] 2.4 两班材料标题可区分 — verify: 列表接口返回的标题带 `1班-` / `2班-` 前缀

## §3 登录、会话与限流
- [x] 3.1 `POST /api/login` 账号口令登录 — verify: `node scripts/capture-login-evidence.mjs` 中成功步骤返回 200
- [x] 3.2 会话 Cookie 属性 HttpOnly + SameSite=Lax — verify: 响应头 `Set-Cookie` 含两个属性
- [x] 3.3 防会话固定：登录成功后换发新会话 ID — verify: 记录登录前后 Cookie 值，应发生变化且旧会话行被删除
- [x] 3.4 `GET /api/me` 返回角色与班级 — verify: 携带 Cookie 请求返回 `role` 与 `className`
- [x] 3.5 未登录访问受保护接口返回 401 且不含材料内容 — verify: 清空 Cookie 请求 `/api/materials`
- [x] 3.6 `POST /api/logout` 删除会话并清 Cookie — verify: 登出后用旧 Cookie 请求 `/api/me` 返回 401
- [x] 3.7 失败提示统一，账号不存在与口令错误响应同形 — verify: 证据脚本中的一致性断言通过
- [x] 3.8 用户名 + IP 失败限流 — verify: 连续 5 次失败后第 6 次即使口令正确仍返回 401

## §4 班级隔离
- [x] 4.1 材料列表只返回本班数据 — verify: teacher01 登录后列表不含 `2班-` 标题
- [x] 4.2 跨班按 ID 访问返回 404 且不带正文 — verify: `GET /api/materials/3`（2 班材料）在 1 班会话下返回 404

## §5 角色授权与上传入库
- [x] 5.1 教师可上传，学生上传返回 403 — verify: 学生会话调用上传接口得到 403
- [x] 5.2 上传同时写入材料表与知识库表（同一事务） — verify: 上传成功后两表各增一行，失败时均不写

## §6 材料读取 API（前端联调）
- [x] 6.1 列表与详情接口字段稳定 — verify: 前端材料页可渲染标题与文件名
- [x] 6.2 上传与下载接口按角色与班级校验 — verify: `npm run capture:upload` 中 403 / 404 / 413 断言通过

## §7 前端页面
- [x] 7.1 登录页：账号、口令、错误提示、深浅色 — verify: 打开 `/` 与 `/?theme=dark` 均可正常渲染
- [x] 7.2 登录成功后跳转材料页并显示角色与班级 — verify: `npm run screenshots` 生成 `04-materials-teacher.png`
- [ ] 7.3 搜索与命令面板 — verify: 输入关键字后列表过滤

## §8 Docker Compose 与文档
- [x] 8.1 `docker-compose.yml` 两服务 web + api（本迭代数据层为 SQLite，db 由命名卷承载，不单独起数据库容器）— verify: `docker compose up -d --build` 后 http://localhost:8080/ 可见登录页
- [x] 8.2 `down` 再 `up` 数据仍在 — verify: 上传一份材料后 `docker compose down && docker compose up -d`，材料仍在列表中
- [x] 8.3 README 说明从零启动步骤、演示账号与 compose 部署 — verify: 按 README 全流程可复现

## §9 发布验收
- [x] 9.1 主路径：登录 → 读取本班材料 → 登出 — verify: `npm run capture:login` 全流程通过
- [x] 9.2 失败路径 1：未登录访问受保护接口 401 — verify: 证据脚本最后一步
- [x] 9.3 失败路径 2：跨班按 ID 访问 404 — verify: 证据脚本跨班步骤
- [x] 9.4 失败路径 3：学生上传 403 且两表不写入 — verify: `npm run capture:upload` 学生上传步骤
