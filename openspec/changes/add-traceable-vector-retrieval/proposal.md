# Change: add-traceable-vector-retrieval

## Why

第 3 课已实现登录、班级隔离与材料入库，但材料只能按标题/正文模糊搜索，使用者无法用一句自然语言在本班材料中定位依据。
本变更让系统具备**可追溯的检索与问答**能力：先在本班材料中检索到切片，再依据切片作答，并标注每一句来自哪份材料、哪一段。

## What Changes

- 新增切分模块：`auto`（默认 800 字窗口 / 80 字重叠）、`custom`（100–2000 字、重叠 0–50%、自定义分隔符与预处理）、`hierarchy`（按 Markdown 标题分章）。
- 新增切片存储与 2-gram 倒排索引（等价于 MySQL `FULLTEXT ... WITH PARSER ngram (token=2)`）。
- 新增嵌入模块：把切片与问句转成向量（OpenAI 兼容服务，可切换阿里云百炼 / 硅基流动 / Ollama / 课程网关）。
- 新增三种检索模式：`keyword`（不调用嵌入）、`vector`（余弦相似度 ≥ 0.35）、`hybrid`（两路各排后 RRF，k=60）。
- 新增 `POST /api/search`：返回材料标题、切片序号、字符区间与摘录（摘录取自关系库中的切片正文）。
- 新增 `POST /api/ask`：先混合检索取前 4 条；无命中直接返回「资料中未找到相关内容」且**不调用对话模型**；有命中才生成带 `[1][2]` 标注的回答。
- 新增 `POST /api/materials/:id/reindex`（教师按新策略重建索引）与 `GET /api/materials/:id/vectors`（查看切片索引状态与向量摘要）。
- 前端新增检索页：模式切换、命中列表（含出处与字符区间）、问答区与出处列表。

## Non-goals

- 不做流式输出与多轮长对话编排（第 5 课）。
- 不引入向量库服务与编排框架：切片正文保存在关系库，向量与切片同表同行，主键一致即可回表；检索逻辑由服务自身实现。
- 不做重排序（交叉编码器）、不做按变更段落增量嵌入。
- 不做跨班检索：跨班一律表现为无命中。

## Impact

- 新增能力规格：`openspec/specs/knowledge-retrieval/spec.md`（归档后生效）。
- 影响数据：新增 `knowledge_chunks`、`chunk_grams` 两张表；`knowledge_chunks` 记录 `embedding`、`embedding_dim`、`embedding_model`、`index_status`。
- 影响代码：`backend/src/{chunking,embeddings,indexing,retrieval,ask,search-routes}.js`、`backend/src/{db,seed,uploads,app,server}.js`、`frontend/src/pages/SearchPage.tsx`、`frontend/src/lib/api.ts`。
- 影响配置：新增 `EMBEDDING_*`、`CHAT_*`、`VECTOR_MIN_SCORE`、`RRF_K`、`RETRIEVE_TOP_K`、`ASK_TOP_K`、`CHUNK_*`。
