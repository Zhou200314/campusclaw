// 检索与问答接口 + 索引维护接口
//   POST /api/search                    三种模式的检索
//   POST /api/ask                       先检索、再生成，无依据不调用模型
//   POST /api/materials/:id/reindex     教师按新策略重建索引
//   GET  /api/materials/:id/vectors     查看切片索引状态与向量摘要
import express from "express";
import { requireAuth, requireRole } from "./auth.js";
import { normalizeHistory, NO_HIT_ANSWER, NO_HIT_CITATIONS, buildContext, SYSTEM_PROMPT } from "./ask.js";
import { reindexMaterial, chunkOptionsFromFields } from "./indexing.js";
import { search } from "./retrieval.js";

const MODES = new Set(["keyword", "vector", "hybrid"]);
const NOT_FOUND_BODY = { error: { code: "NOT_FOUND", message: "材料不存在" } };
const EMPTY_QUERY_BODY = { error: { code: "EMPTY_QUERY", message: "查询内容不能为空" } };

export function createSearchRouter({ db, config, embedder, chat }) {
  const router = express.Router();

  router.post("/api/search", requireAuth, async (req, res, next) => {
    const q = typeof req.body?.q === "string" ? req.body.q.trim() : "";
    const mode = MODES.has(req.body?.mode) ? req.body.mode : "hybrid";
    if (q === "") return res.status(400).json(EMPTY_QUERY_BODY);

    try {
      const result = await search({
        db,
        config,
        embedder,
        question: q,
        mode,
        classId: req.user.classId,     // 班级只来自会话
        limit: req.body?.limit,
        offset: Number(req.body?.offset) || 0
      });
      return res.status(200).json({
        query: q,
        mode,
        classId: req.user.classId,
        embedding: { provider: embedder.kind, model: embedder.model, dim: embedder.dim, called: mode !== "keyword" },
        counts: result.counts,
        hits: result.hits.map((h) => ({
          chunk_id: h.chunkId,
          material_id: h.materialId,
          material_title: h.materialTitle,
          knowledge_entry_id: h.knowledgeEntryId,
          chunk_index: h.chunkIndex,
          char_start: h.charStart,
          char_end: h.charEnd,
          snippet: h.snippet,
          score: h.score ?? h.keywordScore ?? h.vectorScore ?? null,
          keyword_score: h.keywordScore ?? null,
          vector_score: h.vectorScore ?? null,
          rank_keyword: h.rankKeyword ?? null,
          rank_vector: h.rankVector ?? null,
          matched_by: h.matchedBy,
          rank: h.rank
        })),
        message: result.hits.length === 0 ? NO_HIT_ANSWER : null
      });
    } catch (err) {
      if (err.status === 503) {
        return res.status(503).json({ error: { code: err.code ?? "VECTOR_UNAVAILABLE", message: err.message } });
      }
      return next(err);
    }
  });

  router.post("/api/ask", requireAuth, async (req, res, next) => {
    const q = typeof req.body?.q === "string" ? req.body.q.trim() : "";
    if (q === "") return res.status(400).json(EMPTY_QUERY_BODY);

    try {
      // 只用最新一句做检索；此前若干轮对话附在模型输入之后
      const result = await search({
        db,
        config,
        embedder,
        question: q,
        mode: "hybrid",
        classId: req.user.classId,
        limit: config.askTopK,
        offset: 0
      });

      if (result.hits.length === 0) {
        // 无依据：不调用对话模型
        return res.status(200).json({
          answer: NO_HIT_ANSWER,
          citations: NO_HIT_CITATIONS,
          hits: [],
          retrieved: 0,
          model_called: false,
          embedding: { provider: embedder.kind, model: embedder.model, dim: embedder.dim }
        });
      }

      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...normalizeHistory(req.body?.history),
        { role: "user", content: "资料：\n" + buildContext(result.hits) + "\n\n问题：" + q }
      ];

      const answer = await chat.complete(messages);
      return res.status(200).json({
        answer,
        citations: result.hits.map((h, i) => ({
          index: i + 1,
          chunk_id: h.chunkId,
          material_id: h.materialId,
          material_title: h.materialTitle,
          chunk_index: h.chunkIndex,
          char_start: h.charStart,
          char_end: h.charEnd,
          snippet: h.snippet
        })),
        hits: result.hits.map((h) => ({ chunk_id: h.chunkId, material_id: h.materialId, material_title: h.materialTitle, chunk_index: h.chunkIndex })),
        retrieved: result.hits.length,
        model_called: true,
        model: chat.model,
        embedding: { provider: embedder.kind, model: embedder.model, dim: embedder.dim }
      });
    } catch (err) {
      if (err.status === 503) {
        return res.status(503).json({ error: { code: err.code ?? "VECTOR_UNAVAILABLE", message: err.message } });
      }
      return next(err);
    }
  });

  router.post("/api/materials/:id/reindex", requireAuth, requireRole("teacher"), async (req, res, next) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(404).json(NOT_FOUND_BODY);
    const material = db.prepare("SELECT * FROM materials WHERE id = ? AND class_id = ?").get(id, req.user.classId);
    if (!material) return res.status(404).json(NOT_FOUND_BODY);

    try {
      const result = await reindexMaterial({
        db,
        config,
        embedder,
        material,
        options: chunkOptionsFromFields(req.body)
      });
      return res.status(200).json({
        material_id: material.id,
        strategy: result.strategy,
        max_chars: result.maxChars,
        overlap_chars: result.overlapChars,
        processed_length: result.processedLength,
        chunk_count: result.chunkCount,
        ready: result.ready,
        failed: result.failed,
        embed_error: result.embedError
      });
    } catch (err) {
      return next(err);
    }
  });

  router.get("/api/materials/:id/vectors", requireAuth, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(404).json(NOT_FOUND_BODY);
    const material = db.prepare("SELECT id, title FROM materials WHERE id = ? AND class_id = ?").get(id, req.user.classId);
    if (!material) return res.status(404).json(NOT_FOUND_BODY);

    const chunks = db
      .prepare("SELECT id, chunk_index, index_status, embedding_dim, embedding_model, embed_error, embedding FROM knowledge_chunks WHERE material_id = ? ORDER BY chunk_index")
      .all(id);

    return res.status(200).json({
      material_id: material.id,
      material_title: material.title,
      embedding: { provider: embedder.kind, model: embedder.model, dim: embedder.dim },
      chunks: chunks.map((c) => {
        let preview = null;
        if (c.embedding) {
          try {
            preview = JSON.parse(c.embedding).slice(0, 8).map((v) => Number(v.toFixed(5)));
          } catch {}
        }
        return {
          chunk_id: c.id,
          chunk_index: c.chunk_index,
          index_status: c.index_status,
          embedding_dim: c.embedding_dim,
          embedding_model: c.embedding_model,
          embed_error: c.embed_error,
          vector_preview: preview      // 只回传前 8 个分量，完整向量不下发到浏览器
        };
      })
    });
  });

  return router;
}
