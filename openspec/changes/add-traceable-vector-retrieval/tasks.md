# Tasks: add-traceable-vector-retrieval

> 完成一项 → 执行该行 verify 并通过 → 勾选 `[x]` → 提交。

## §1 切分
- [x] 1.1 `auto` 默认 800 字 / 80 字重叠，优先在空行、换行、句号处断开 — verify: 2000 字文本切出多片且相邻片重叠
- [x] 1.2 `custom` 长度 100–2000、重叠 0–50%、可自定义分隔符 — verify: 传入 300/20% 与 100/0% 得到不同切片数
- [x] 1.3 `hierarchy` 按 Markdown 标题分章且标题保留在切片内 — verify: 带 4 个标题的材料切出 4 片，每片首行是标题
- [x] 1.4 预处理（移除链接、折叠空白）不改写原文，偏移量相对预处理后文本 — verify: 上传原文仍存原始 `body`，切片偏移与预处理后文本一致

## §2 索引与嵌入
- [x] 2.1 切片写入 `knowledge_chunks`，2-gram 倒排写入 `chunk_grams` — verify: 上传后两表行数同步增加
- [x] 2.2 按 provider 批量上限分批嵌入（阿里云 v3/v4 为 10 条） — verify: 单批不超过 10 条且全部 ready
- [x] 2.3 嵌入失败时材料与切片保留、切片标记 `failed` — verify: 断开嵌入服务后重传，材料仍在、切片为 failed
- [x] 2.4 换嵌入模型时自动重建索引 — verify: 先用 local 再用 text-embedding-v4 跑补齐，切片记录模型同步更新
- [x] 2.5 启动时给没有索引的材料补齐（含种子材料） — verify: 首次启动日志出现"索引补齐完成"

## §3 三种检索
- [x] 3.1 `keyword` 只查倒排、不调用嵌入 — verify: 该模式返回的响应中 `embedding.called=false`
- [x] 3.2 `vector` 余弦低于 0.35 丢弃 — verify: 无关问句返回 0 条
- [x] 3.3 `hybrid` 用 RRF(k=60) 融合两路名次 — verify: 两路都命中的切片排在只有单路命中的之前
- [x] 3.4 每条命中含材料标题、切片序号、字符区间与摘录 — verify: 响应字段 `material_title/chunk_index/char_start/char_end/snippet` 齐全
- [x] 3.5 空查询返回 400 — verify: `{"q":"  "}` 返回 `EMPTY_QUERY`
- [x] 3.6 向量服务不可用时返回 503，不伪造分数 — verify: 未配置嵌入时 `vector`/`hybrid` 返回 503，`keyword` 仍 200

## §4 问答
- [x] 4.1 先混合检索取前 4 条 — verify: 有依据时 `retrieved ≤ 4` 且 citations 与切片一一对应
- [x] 4.2 无命中不调用模型 — verify: 无依据时 `model_called=false`、`citations=[]`、固定文案
- [x] 4.3 回答中的 `[1][2]` 与出处列表顺序一致 — verify: 回答里出现的编号 ≤ citations 数量
- [x] 4.4 丢弃客户端注入的 system 消息 — verify: 传入 system 后模型输入仍以服务端 system 开头

## §5 检索侧班级隔离
- [x] 5.1 关键字与向量两条路径都按会话班级过滤 — verify: 1 班会话检索 2 班独有词返回空
- [x] 5.2 请求体中的 `class_id` 被丢弃 — verify: 注入 `class_id=2` 的结果与不注入完全一致
- [x] 5.3 跨班检索表现为无命中而非 403/404 — verify: 返回 200 且 hits 为空
- [x] 5.4 跨班材料详情仍 404（沿用第 3 课） — verify: 1 班访问 2 班材料详情返回 404

## §6 索引维护与前端
- [x] 6.1 教师可按新策略重建索引，先删旧切片再写入 — verify: 重建后切片数与旧策略不同且无残留旧主键
- [x] 6.2 学生重建索引返回 403 — verify: 学生会话调用 `/reindex` 得 403
- [x] 6.3 `GET /api/materials/:id/vectors` 只回传向量前 8 个分量 — verify: 响应中 `vector_preview` 长度为 8
- [x] 6.4 检索页：模式切换、命中列表、问答区与出处列表 — verify: 前端构建产物包含检索页文案，页面可完成一次检索与提问

## §7 验收
- [x] 7.1 主路径：登录 → 检索 → 提问 → 打开出处对应材料 — verify: 见 `docs/evidence/retrieval-request-response.md`
- [x] 7.2 失败路径：空查询 400 / 未登录 401 / 学生重建 403 / 跨班材料 404 — verify: 同上第 6 节
- [x] 7.3 无依据路径：固定文案且未调用对话模型 — verify: 同上第 4 节
