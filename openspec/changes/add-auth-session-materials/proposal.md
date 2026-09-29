# Change: add-auth-session-materials

## Why

CampusClaw 的后续智能能力（学情分析、备课、命题、教研协同）都建立在两个前提上：**能确认访问者是谁、属于哪个班**，以及**教研材料能可靠入库且不跨班泄露**。
本变更交付迭代 1 的底座：登录与会话、角色权限、班级数据边界、教研材料上传与知识库入库。

## What Changes

- 新增账号口令登录与会话管理：`POST /api/login`、`POST /api/logout`、`GET /api/me`。
- 新增角色（教师 / 学生）与班级（租户）授权：身份、角色、班级一律来自服务端会话。
- 新增教研材料读取接口：`GET /api/materials`、`GET /api/materials/:id`，按班级隔离。
- 新增前端登录页与材料页：深浅色主题、统一失败提示、登录后展示服务端返回的角色与班级。
- 新增种子数据：双班、两种角色、4 个账号、两班标题可区分的材料。

## Non-goals

- 不做检索、问答与 RAG：知识库本迭代只负责存储正文。
- 不做平台超级管理员角色：跨班角色会与「跨班返回 404」的隔离验收冲突，推迟到后续迭代。
- 不使用 JWT / Bearer / OAuth：本迭代是浏览器同源站点，会话 Cookie 可立即失效。
- 不做多副本部署与共享会话存储：单实例足够验收。
- 界面美化不替代鉴权：绕过界面直接调接口仍必须被拒绝。

## Impact

- 新增能力规格：`openspec/specs/auth-upload/spec.md`（归档后生效）。
- 影响代码：`backend/src/{config,db,security,cookies,ratelimit,auth,materials,app,server,seed}.js`、`frontend/src/**`。
- 影响配置：新增必填 `SESSION_SECRET`，以及 `PORT`、`DB_PATH`、`SESSION_TTL_SECONDS`、`LOGIN_FAIL_THRESHOLD`、`LOGIN_LOCK_SECONDS`、`SEED_*` 等。
- 影响依赖：Node.js ≥ 22.5（内置 `node:sqlite`）、Express、React、TypeScript。
