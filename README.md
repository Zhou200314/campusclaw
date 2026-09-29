# CampusClaw · 迭代 1 + 迭代 2（登录与会话 · 材料上传入库 · 可追溯知识库检索）

面向中小学的教研智能体 CampusClaw 的第一迭代底座：**账号口令登录、角色权限、班级数据边界、教研材料上传与知识库入库**。

## 1. 交付内容

| 位置 | 说明 |
| --- | --- |
| `frontend/` | 登录页与材料页（React + TypeScript + Vite；深浅色、演示账号、上传表单、下载按钮） |
| `backend/` | 接口服务（Node.js 22 + Express；会话 Cookie、限流、班级隔离、上传入库、下载鉴权） |
| `frontend/dist/` | 已构建的前端产物，后端直接托管，同源免跨域 |
| `scripts/capture-login-evidence.mjs` | 采集登录请求参数与响应原文 |
| `scripts/capture-upload-evidence.mjs` | 采集上传/下载/权限/事务证据 |
| `scripts/capture-screenshots.mjs` | 一键生成运行截图（登录页、材料页、上传区） |
| `docs/evidence/` | 已生成的请求/响应证据与截图输出目录 |
| `openspec/changes/add-auth-session-materials/` | 本次变更四件套（proposal / design / tasks / spec） |
| `uploads/` | 上传文件落盘目录（按班级分目录，已被 `.dockerignore`/`.gitignore` 排除） |

## 2. 快速开始

```powershell
# 1) 安装依赖（首次）
npm run install:all

# 2) 构建前端（dist 不入库，克隆后必须先构建）
npm run build:offline          # 等价于 cd frontend && node scripts/build-offline.mjs

# 3) 准备配置（至少改掉 SESSION_SECRET；要用真实模型再填 EMBEDDING_*/CHAT_*）
Copy-Item .env.example .env

# 4) 启动（后端同时托管前端构建产物）
npm start

# 浏览器打开 http://127.0.0.1:8080/
```

> 缺少 `SESSION_SECRET` 时服务端**直接启动失败**（失败即停，不内置默认密钥）。
> `.env` 已被 `.gitignore` 与 `.dockerignore` 排除，不会进入仓库与镜像。
> 未配置 `EMBEDDING_*` 时自动降级为本地伪向量，链路可跑通但语义检索能力很弱（详见第 11 节）。

### 演示账号

| 账号 | 角色 | 班级 | 口令来源 |
| --- | --- | --- | --- |
| `teacher01` | 教师 | 高一(1)班 | `SEED_TEACHER_PASSWORD`（示例 `Teacher@123`） |
| `student01` | 学生 | 高一(1)班 | `SEED_STUDENT_PASSWORD`（示例 `Student@123`） |
| `teacher02` | 教师 | 高一(2)班 | `SEED_TEACHER_PASSWORD` |
| `student02` | 学生 | 高一(2)班 | `SEED_STUDENT_PASSWORD` |

### 跨班可见开关（CROSS_CLASS_VISIBLE）

默认关闭，行为与课程要求一致：**跨班材料完全不可见**，按 ID 访问或下载一律 404。

设为 `1` 时进入"可见但不可下载"模式，用于演示"看得到、拿不走"：

| 场景 | 默认（=0） | 演示模式（=1） |
| --- | --- | --- |
| 材料列表 | 只有本班材料 | 含其他班级材料，带班级标签 |
| 跨班详情 `GET /api/materials/:id` | 404 | 200，但 `body: null`、`canDownload: false`（不下发正文） |
| 跨班下载 `/download` | 404（与不存在同形） | **403** `DOWNLOAD_FORBIDDEN`「无权下载其他班级的材料」 |
| 本班下载 | 200 | 200 |

```powershell
# 本地演示
$env:CROSS_CLASS_VISIBLE=1; npm start
# 前端会显示“全部班级材料”，别班条目带班级标签并显示“不可下载”

# Docker Compose 演示
$env:CROSS_CLASS_VISIBLE=1; docker compose up -d
```

> 注意：课程"班级隔离"验收要求跨班按 ID 访问取不到对方标题与正文，因此**交作业时保持默认 0**；
> 只有在需要演示"可见但不可下载"时才打开该开关。

## 3. 接口一览

| 方法 | 路径 | 角色 | 说明 | 失败响应 |
| --- | --- | --- | --- | --- |
| POST | `/api/login` | 公开 | 账号口令登录，成功下发会话 Cookie | 401 `INVALID_CREDENTIALS`（统一文案） |
| GET | `/api/me` | 登录 | 返回当前身份、角色、班级 | 401 `UNAUTHENTICATED` |
| POST | `/api/logout` | 登录 | 删除服务端会话并清 Cookie | 204 |
| GET | `/api/materials` | 登录 | 仅返回**本班**材料，支持 `?q=` 搜索 | 401 |
| GET | `/api/materials/:id` | 登录 | 按 ID 读取；跨班与不存在同形 404 | 401 / 404 |
| POST | `/api/materials` | **教师** | `multipart/form-data` 上传（字段 `file` + 可选 `title`），材料表与知识库表同事务写入 | 403（学生）/ 413（超限）/ 401 |
| GET | `/api/materials/:id/download` | 登录 | 下载附件；默认跨班 404，开启跨班可见后跨班 403 | 401 / 403 / 404 |

### 登录请求与响应

```http
POST /api/login HTTP/1.1
Content-Type: application/json

{"username":"teacher01","password":"Teacher@123"}
```

```http
HTTP/1.1 200 OK
Set-Cookie: cc_session=<64位十六进制令牌>; Path=/; Max-Age=7200; HttpOnly; SameSite=Lax

{"user":{"id":1,"username":"teacher01","displayName":"王老师","role":"teacher","classId":1,"className":"高一(1)班"}}
```

失败时（口令错误 / 账号不存在 / 锁定期）返回完全一致的：

```http
HTTP/1.1 401 Unauthorized
{"error":{"code":"INVALID_CREDENTIALS","message":"用户名或密码错误"}}
```

### 上传请求与响应

```http
POST /api/materials HTTP/1.1
Cookie: cc_session=…
Content-Type: multipart/form-data; boundary=----CampusClaw

------CampusClaw
Content-Disposition: form-data; name="title"

1班-三角函数复习提纲
------CampusClaw
Content-Disposition: form-data; name="file"; filename="upload-test.md"
Content-Type: text/markdown

（文件内容）
------CampusClaw--
```

```http
HTTP/1.1 201 Created

{"material":{"id":5,"title":"1班-三角函数复习提纲","filename":"upload-test.md","sizeBytes":141,"classId":1,"uploadedBy":"王老师"},
 "knowledgeEntry":{"id":1,"materialId":5,"extracted":true,"note":null}}
```

学生会话调用同一接口：`403 {"error":{"code":"FORBIDDEN","message":"当前角色无权执行该操作"}}`

## 4. 上传入库的实现要点

1. **角色先于文件**：`requireAuth → requireRole("teacher")`，学生请求在读取文件前就被拒绝。
2. **班级来自会话**：落盘路径为 `uploads/<classId>/<uuid>-<净化后的原文件名>`，请求参数无法指定班级。
3. **双表同事务**：`BEGIN IMMEDIATE` → 写 `materials` → 写 `knowledge_entries` → `COMMIT`；任一失败 `ROLLBACK` 并删除已落盘文件，不产生"只有文件没有记录"或"只有材料没有知识条目"的中间态。
4. **正文提取**：文本类文件（`.md/.txt/.csv/.json/.yml/.html` 等）按 UTF-8 提取正文（上限 20 万字符）；二进制文件只登记来源信息。知识库本迭代只负责存，不做检索与问答。
5. **大小上限**：由 `UPLOAD_MAX_BYTES` 控制，超限返回 413 且不写库。
6. **下载同样鉴权**：`GET /api/materials/:id/download` 先按会话班级过滤，跨班与不存在同形 404。

### 支持的文件类型

**上传本身不限制类型**（不做扩展名/MIME 白名单），但"能否提取正文进入知识库"分三档：

| 档位 | 判定方式 | 文件类型 | 知识库正文 | 可下载 |
| --- | --- | --- | --- | --- |
| A 扩展名白名单 | `knowledge.js` 的 `TEXT_EXTENSIONS` | `.txt .md .markdown .csv .tsv .json .log .yml .yaml .html .htm .tex .srt .vtt` | ✅ 提取 UTF-8 全文（上限 20 万字符） | ✅ |
| B 内容嗅探 | 前 4 KB 无 NUL 且控制字符 < 5% | 任意扩展名（含无扩展名）的纯文本，如 `.xyz`、`noext` | ✅ 同样提取 | ✅ |
| C 二进制 | 命中 A/B 以外的内容 | `.docx .pdf .xlsx .png .jpg .zip .exe` 等 | ❌ 只写占位说明与来源文件名 | ✅（走鉴权下载） |

实测（`node work/filetype-probe.mjs`）：

```
notes.md    201 extracted=true   "# 标题\n\n这是 UTF-8 文本。"
weird.xyz   201 extracted=true   "未知扩展名但内容是纯文本。"     ← 扩展名不在白名单，靠内容嗅探
noext       201 extracted=true   "没有扩展名的纯文本。"
photo.png   201 extracted=false  "（二进制文件，未提取正文…）"
report.pdf  201 extracted=false  "（二进制文件，未提取正文…）"
doc.docx    201 extracted=false  "（二进制文件，未提取正文…）"
tool.exe    201 extracted=false  "（二进制文件，未提取正文…）"     ← 可上传可下载，但正文不入库
```

> 因此：**"能不能上传"和"能不能被搜索到"是两件事**。docx/pdf/图片能上传、能下载，但按内容搜索不到；`GET /api/materials?q=` 只检索已提取的正文与标题。

## 5. Docker Compose 部署

```powershell
Copy-Item .env.example .env      # 首次：填好 SESSION_SECRET 与两个种子口令
docker compose up -d --build     # 构建并后台启动
docker compose ps                # 查看状态：api 应为 healthy，web 为 running
# 浏览器打开 http://localhost:8080/
docker compose logs -f api       # 查看后端启动日志
docker compose down              # 停止（命名卷保留，数据不丢）
docker compose up -d             # 再启动：数据仍在
```

| 服务 | 镜像 | 作用 | 端口 |
| --- | --- | --- | --- |
| `api` | `campusclaw-api:iter1` | Node + Express 接口；SQLite 文件与上传目录挂命名卷 | 仅 compose 内网 8080 |
| `web` | `campusclaw-web:iter1` | nginx：托管前端构建产物，并把 `/api` 反向代理到 api | 宿主机 `${WEB_PORT:-8080}` |

**数据持久化**：命名卷 `campusclaw-data`（数据库）与 `campusclaw-uploads`（上传文件），`docker compose down` 不会删除，`down -v` 才会清空。

**一键冒烟验证**（构建 → 启动 → 登录 → 上传 → down/up → 数据仍在）：

```powershell
node scripts/compose-smoke.mjs   # 或 npm run compose:smoke
```

**手动验证持久化**（课程第 7 步的 verify）：

```powershell
docker compose up -d
# 浏览器登录 teacher01，上传一份材料
docker compose down && docker compose up -d
# 重新打开材料页：刚才上传的材料仍在列表中
```

**镜像卫生**：`.dockerignore` 排除了 `.env`、`data/`、`uploads/`、`node_modules` 与 `dist`；运行时配置全部由 compose 的 `environment` 注入，镜像内不含任何密钥。

**失败即停**：compose 用 `${SESSION_SECRET:?…}` 语法声明必填变量，未配置时 `docker compose up` 直接报错退出，不会用空值启动。

**反向代理下的限流**：api 服务设置了 `TRUST_PROXY=1`，Express 会按 `X-Forwarded-For` 解析真实客户端 IP，登录限流才按访客而非 nginx 容器 IP 计数。

**国内网络**：构建时的 npm 源由 `NPM_REGISTRY` 控制，默认已指向 `https://registry.npmmirror.com`；如 Docker Hub 拉取慢，可在 Docker Desktop 里配置镜像加速器。

## 7. 作业证据生成

```powershell
npm run capture:login    # 登录请求参数 / 响应原文 / 防会话固定 / 限流
npm run capture:upload   # 上传成功 / 学生 403 / 跨班 404 / 超限 413 / 双表计数
npm install              # 安装 playwright-core（截图用）
npm run screenshots      # 生成运行截图
```

产物：

- `docs/evidence/login-request-response.md`
- `docs/evidence/upload-request-response.md`
- `docs/evidence/01~06*.png`

## 8. 安全设计要点

| 要求 | 实现位置 |
| --- | --- |
| 配置外置、密钥缺失即启动失败 | `backend/src/config.js` |
| 口令散列存储 + 恒定时间比较 | `backend/src/security.js` |
| 会话 Cookie：HttpOnly + SameSite=Lax | `backend/src/auth.js` |
| 防会话固定：登录成功换发会话 ID | `backend/src/auth.js` |
| 登出后旧 Cookie 立即失效 | `backend/src/auth.js` |
| 登录失败统一提示 + 用户名&IP 限流 | `backend/src/auth.js` / `ratelimit.js` |
| 角色校验先于文件处理 | `backend/src/uploads.js` |
| 上传落盘文件名净化，杜绝路径穿越 | `backend/src/uploads.js`（`safeFilename`） |
| 双表同事务 | `backend/src/uploads.js`（BEGIN/COMMIT/ROLLBACK） |
| 班级数据边界（列表、详情、下载） | `backend/src/materials.js` / `uploads.js` |

## 9. 与课程八步的对应

| 课程步骤 | 状态 |
| --- | --- |
| 1 骨架与配置 | ✅ 目录骨架、`.env.example`、`.gitignore`、`.dockerignore`、缺配置启动失败 |
| 2 数据与种子 | ✅ 双班、两种角色、4 个账号、可区分标题的材料 |
| 3 登录与会话 | ✅ Cookie 会话、中间件、登出、限流、防会话固定、统一失败响应 |
| 4 班级隔离 | ✅ 列表过滤 + 按 ID 核对 + 下载隔离（跨班 404） |
| 5 上传入库 | ✅ 教师可传、学生 403、双表同事务、正文提取、下载走鉴权 |
| 6 前端页面 | 🟡 登录页、材料页、上传表单已完成；搜索框可用，命令面板待补 |
| 7 Compose | ✅ `docker-compose.yml` + `docker/`：web(nginx) + api(Node)，SQLite 与上传目录走命名卷，`down` 后数据仍在 |
| 8 验收 | ✅ 主路径 + 三条失败路径（未登录 401 / 跨班 404 / 学生上传 403）均有证据 |

## 11. 第 4 课：可追溯知识库检索

在既有登录 / 上传 / 班级隔离之上新增检索与问答能力，实现与课件规约一致：

| 能力 | 实现位置 | 说明 |
| --- | --- | --- |
| 三种切分策略 | `backend/src/chunking.js` | `auto`（800 字窗口 / 80 字重叠，优先空行、换行、句号断开）、`custom`（100–2000 字、重叠 0–50%、可自定义分隔符与预处理）、`hierarchy`（按 Markdown `#/##/###` 分章） |
| 切片与倒排索引 | `knowledge_chunks` / `chunk_grams` 表 | 切片正文存关系库；2-gram 倒排等价于课程里 MySQL `FULLTEXT ... WITH PARSER ngram (token=2)` |
| 向量 | `knowledge_chunks.embedding` | 与切片主键同表同行；换成 Qdrant 只需替换 `embedding` 的读写 |
| 嵌入与对话 | `backend/src/embeddings.js` / `ask.js` | 均为 OpenAI 兼容 provider，可用阿里云百炼、硅基流动、Ollama 或课程网关 |
| 三种检索 | `backend/src/retrieval.js` | keyword 不调嵌入；vector 余弦 ≥0.35 保留；hybrid 两路各排后 RRF(k=60)，缺席一路不加分 |
| 可追溯 | `POST /api/search` 返回 | 每条命中含材料标题、切片序号、字符区间 `char_start/char_end` 与摘录（摘录取关系库切片正文） |
| 问答 | `POST /api/ask` | 先混合检索取前 4 条；无命中直接返回「资料中未找到相关内容」且**不调用对话模型**；有命中才调用，回答用 `[1][2]` 标注并与 citations 顺序一致 |
| 重建索引 | `POST /api/materials/:id/reindex` | 教师按新策略重建：先删旧切片与旧向量，再按本次策略写入 |
| 向量查看 | `GET /api/materials/:id/vectors` | 返回切片索引状态与向量前 8 个分量（完整向量不下发浏览器） |

### 11.1 配置模型

```ini
EMBEDDING_PROVIDER=openai
EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
EMBEDDING_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIM=1024
CHAT_PROVIDER=openai
CHAT_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
CHAT_API_KEY=sk-...
CHAT_MODEL=qwen-plus
```

> 没有配 key 时把两个 provider 设成 `local`，即可用本地伪向量 + 摘录式回答跑通整条链路（向量检索的语义能力会明显变弱，仅用于自测）。

### 11.2 失败语义

| 场景 | 行为 |
| --- | --- |
| 空查询 | 400 `EMPTY_QUERY` |
| 嵌入服务未配置 / 调用失败 | keyword 仍可用；vector 与 hybrid 返回 **503**，不伪造相似度 |
| 无命中切片 | `POST /api/search` 返回 200 + 空 hits；`POST /api/ask` 返回固定文案且 `model_called: false` |
| 跨班检索 | 班级取自会话，表现为**无命中**（不返回 403/404） |
| 嵌入失败 | 材料与切片保留，切片标记 `failed`，不写入不完整的向量 |

## 10. 已知限制

- 数据层使用 SQLite（Node 内置 `node:sqlite`，需要 Node ≥ 22.5）；换 MySQL 只需替换 `backend/src/db.js`。
- 二进制格式（docx/pdf/xlsx/图片）暂不提取正文，只登记来源信息；知识库不做检索与问答（Non-goals）。
- 正文只按 **UTF-8** 解码：GBK/GB18030 编码的文本文件会变成乱码（实测 `中文测试` → `���Ĳ���`）；`.txt` 等白名单扩展名优先于内容嗅探，把二进制文件改名成 `.txt` 会写入乱码，且 `node:sqlite` 在首个 NUL 字节处截断存储（实测 49 字节文件只留下 3 个字符）。需要支持 GB18030 或 docx/pdf 时见 README 第 4 节与已知限制。
- `frontend/dist` 由 `npm run build:offline`（rollup + TypeScript，纯进程内）产出，适配无法创建子进程的环境；常规开发请用 `npm run build`（Vite）。
- 本机 HTTP 演示不加 Cookie `Secure` 属性；部署 HTTPS 时设置 `COOKIE_SECURE=1`。
