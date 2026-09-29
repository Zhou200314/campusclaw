// 检索模块：三种模式
//   keyword 只查 2-gram 倒排（对应课程的 MySQL FULLTEXT ngram），不调用嵌入
//   vector  问句嵌入 → 与切片向量算余弦 → 低于阈值丢弃 → 回关系库取正文
//   hybrid  两条路径各自排序后按 RRF（k=60）融合；缺席的一路不贡献分数
// 班级条件一律由调用方传入的会话班级决定，且关键字与向量两条路径都要带上。
import { cosineSimilarity, toNgrams } from "./embeddings.js";

const SNIPPET_LENGTH = 160;

function chunkRowToHit(row) {
  return {
    chunkId: row.id,
    materialId: row.material_id,
    materialTitle: row.material_title,
    knowledgeEntryId: row.knowledge_entry_id,
    chunkIndex: row.chunk_index,
    charStart: row.char_start,
    charEnd: row.char_end,
    snippet: String(row.chunk_text).slice(0, SNIPPET_LENGTH),
    chunkText: row.chunk_text
  };
}

export function keywordSearch(db, { text, classId, limit = 10, offset = 0 }) {
  const grams = toNgrams(text);
  if (grams.length === 0) return [];

  const placeholders = grams.map(() => "?").join(",");
  const rows = db
    .prepare(
      "SELECT cg.chunk_id, cg.gram FROM chunk_grams cg " +
        "JOIN knowledge_chunks kc ON kc.id = cg.chunk_id " +
        "WHERE kc.class_id = ? AND kc.index_status = 'ready' AND cg.gram IN (" + placeholders + ")"
    )
    .all(classId, ...grams);
  if (rows.length === 0) return [];

  const totalReady = Number(
    db.prepare("SELECT COUNT(*) AS n FROM knowledge_chunks WHERE class_id = ? AND index_status = 'ready'").get(classId).n
  );
  const df = new Map();
  const perChunk = new Map();
  for (const row of rows) {
    df.set(row.gram, (df.get(row.gram) ?? 0) + 1);
    if (!perChunk.has(row.chunk_id)) perChunk.set(row.chunk_id, new Set());
    perChunk.get(row.chunk_id).add(row.gram);
  }

  const idf = new Map();
  for (const [gram, d] of df) idf.set(gram, Math.log(1 + (totalReady - d + 0.5) / (d + 0.5)));

  const scored = [];
  for (const [chunkId, matched] of perChunk) {
    let score = 0;
    for (const gram of matched) score += idf.get(gram) ?? 0;
    const gramCount = Number(db.prepare("SELECT COUNT(*) AS n FROM chunk_grams WHERE chunk_id = ?").get(chunkId).n) || 1;
    scored.push({ chunkId, score: score / Math.sqrt(gramCount) });
  }
  scored.sort((a, b) => b.score - a.score);

  const page = scored.slice(offset, offset + limit);
  if (page.length === 0) return [];
  const ids = page.map((p) => p.chunkId);
  const detailPlaceholders = ids.map(() => "?").join(",");
  const details = db
    .prepare(
      "SELECT kc.*, m.title AS material_title FROM knowledge_chunks kc " +
        "JOIN materials m ON m.id = kc.material_id WHERE kc.id IN (" + detailPlaceholders + ")"
    )
    .all(...ids);
  const byId = new Map(details.map((d) => [d.id, d]));

  return page
    .map((p, i) => {
      const row = byId.get(p.chunkId);
      if (!row) return null;
      return { ...chunkRowToHit(row), keywordScore: p.score, rank: offset + i + 1, matchedBy: ["keyword"] };
    })
    .filter(Boolean);
}

export function vectorSearch(db, { queryVector, classId, minScore = 0.35, limit = 10, offset = 0, embeddingModel = null }) {
  // embedding_model 必须与当前嵌入模型一致：不同模型的向量空间不可比较
  const sql =
    "SELECT kc.*, m.title AS material_title FROM knowledge_chunks kc " +
    "JOIN materials m ON m.id = kc.material_id " +
    "WHERE kc.class_id = ? AND kc.index_status = 'ready' AND kc.embedding IS NOT NULL" +
    (embeddingModel ? " AND kc.embedding_model = ?" : "") +
    " ORDER BY kc.id";
  const rows = embeddingModel ? db.prepare(sql).all(classId, embeddingModel) : db.prepare(sql).all(classId);

  const scored = [];
  for (const row of rows) {
    let vec;
    try {
      vec = JSON.parse(row.embedding);
    } catch {
      continue;
    }
    const score = cosineSimilarity(queryVector, vec);
    if (score >= minScore) scored.push({ row, score });
  }
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(offset, offset + limit).map((item, i) => ({
    ...chunkRowToHit(item.row),
    vectorScore: item.score,
    rank: offset + i + 1,
    matchedBy: ["vector"]
  }));
}

// RRF：score = Σ 1/(k + rank)，只按名次融合，不把两路分数相加
export function fuseRrf(keywordHits, vectorHits, k = 60) {
  const merged = new Map();
  const touch = (h) => {
    if (!merged.has(h.chunkId)) merged.set(h.chunkId, { ...h, keywordScore: null, vectorScore: null, matchedBy: [] });
    return merged.get(h.chunkId);
  };
  keywordHits.forEach((h) => {
    const item = touch(h);
    item.keywordScore = h.keywordScore;
    item.rankKeyword = h.rank;
    item.matchedBy = [...new Set([...item.matchedBy, "keyword"])];
    item.score = (item.score ?? 0) + 1 / (k + h.rank);
  });
  vectorHits.forEach((h) => {
    const item = touch(h);
    item.vectorScore = h.vectorScore;
    item.rankVector = h.rank;
    item.matchedBy = [...new Set([...item.matchedBy, "vector"])];
    item.score = (item.score ?? 0) + 1 / (k + h.rank);
  });
  return [...merged.values()].sort((a, b) => b.score - a.score);
}

export async function search({ db, config, embedder, question, mode = "hybrid", classId, limit, offset = 0 }) {
  const topK = Math.min(Math.max(Number(limit) || config.retrieveTopK, 1), 50);
  const errors = [];
  let keywordHits = [];
  let vectorHits = [];

  if (mode === "keyword" || mode === "hybrid") {
    keywordHits = keywordSearch(db, { text: question, classId, limit: topK, offset: 0 });
  }

  if (mode === "vector" || mode === "hybrid") {
    if (!embedder.available()) {
      const err = new Error("向量检索不可用：嵌入服务未配置");
      err.code = "EMBEDDING_UNAVAILABLE";
      err.status = 503;
      throw err;
    }
    try {
      const [queryVector] = await embedder.embed([question]);
      vectorHits = vectorSearch(db, { queryVector, classId, minScore: config.vectorMinScore, limit: topK, offset: 0, embeddingModel: embedder.model });
    } catch (err) {
      if (err.status === 503) throw err;
      const e = new Error("向量检索不可用：" + err.message);
      e.code = "VECTOR_UNAVAILABLE";
      e.status = 503;
      throw e;
    }
  }

  let hits;
  if (mode === "hybrid") {
    hits = fuseRrf(keywordHits, vectorHits, config.rrfK);
  } else if (mode === "vector") {
    hits = vectorHits;
  } else {
    hits = keywordHits;
  }

  const paged = hits.slice(offset, offset + topK).map((h, i) => ({ ...h, rank: offset + i + 1 }));
  return {
    hits: paged,
    counts: { keyword: keywordHits.length, vector: vectorHits.length, total: hits.length },
    errors
  };
}
