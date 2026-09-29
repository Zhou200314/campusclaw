// 入库与索引：正文 → 切片 → 2-gram 倒排 → 向量。
// 关键约定（与课件一致）：
//   · 切片正文保存在关系库（knowledge_chunks），向量库只保存向量与标识，二者主键相同
//   · 嵌入失败时材料与切片仍保留，切片标记为 failed，不写入不完整的向量
//   · 重建索引先删除旧切片与旧向量，再按本次策略重新写入
import { chunkText } from "./chunking.js";
import { toNgrams } from "./embeddings.js";
import { nowIso } from "./db.js";

// 把请求字段（表单或 JSON）转成切分参数；未提供的项交给 chunkText 取默认值
export function chunkOptionsFromFields(body = {}) {
  const bool = (v) => v === true || v === "1" || v === "true" || v === 1;
  return {
    strategy: ["auto", "custom", "hierarchy"].includes(body.chunk_strategy) ? body.chunk_strategy : undefined,
    separator: typeof body.chunk_separator === "string" && body.chunk_separator.length ? body.chunk_separator : undefined,
    maxChars: body.chunk_max_chars !== undefined && body.chunk_max_chars !== "" ? Number(body.chunk_max_chars) : undefined,
    overlapPercent:
      body.chunk_overlap_percent !== undefined && body.chunk_overlap_percent !== "" ? Number(body.chunk_overlap_percent) : undefined,
    collapseWhitespace: bool(body.chunk_collapse_ws),
    stripLinks: bool(body.chunk_strip_links)
  };
}

export function deleteChunks(db, materialId) {
  // chunk_grams 通过外键 ON DELETE CASCADE 一并清理
  db.prepare("DELETE FROM knowledge_chunks WHERE material_id = ?").run(materialId);
}

export async function reindexMaterial({ db, config, embedder, material, options = {} }) {
  // 老数据（或直接写库的种子材料）可能没有 knowledge_entries 行，这里在事务内补齐后再切分
  const existingEntry = db.prepare("SELECT * FROM knowledge_entries WHERE material_id = ?").get(material.id);
  const text = existingEntry?.body ?? material.body ?? "";

  const result = chunkText(text, {
    strategy: options.strategy,
    maxChars: options.maxChars ?? config.chunkMaxChars,
    overlapPercent: options.overlapPercent,
    separator: options.separator,
    stripLinks: options.stripLinks === true,
    collapseWhitespace: options.collapseWhitespace === true
  });

  // 事务：先删旧切片，再写入新切片（此时尚未嵌入）
  db.exec("BEGIN IMMEDIATE");
  try {
    let entry = existingEntry;
    if (!entry) {
      const info = db
        .prepare(
          "INSERT INTO knowledge_entries (material_id, class_id, title, body, source, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(material.id, material.class_id, material.title, text, material.filename ?? null, nowIso());
      entry = { id: Number(info.lastInsertRowid) };
    }
    deleteChunks(db, material.id);
    const insertChunk = db.prepare(
      "INSERT INTO knowledge_chunks (knowledge_entry_id, material_id, class_id, chunk_index, chunk_text, char_start, char_end, strategy, index_status, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)"
    );
    const insertGram = db.prepare("INSERT OR IGNORE INTO chunk_grams (chunk_id, gram) VALUES (?, ?)");
    const created = [];
    for (const c of result.chunks) {
      const info = insertChunk.run(
        entry.id,
        material.id,
        material.class_id,
        c.index,
        c.text,
        c.start,
        c.end,
        result.strategy,
        nowIso()
      );
      const chunkId = Number(info.lastInsertRowid);
      created.push({ id: chunkId, text: c.text });
      for (const gram of toNgrams(c.text)) insertGram.run(chunkId, gram);
    }
    db.exec("COMMIT");
    const embedded = await embedChunks({ db, config, embedder, chunks: created });
    return {
      strategy: result.strategy,
      maxChars: result.maxChars,
      overlapChars: result.overlapChars,
      processedLength: result.processedLength,
      chunkCount: created.length,
      ready: embedded.ready,
      failed: embedded.failed,
      embedError: embedded.error
    };
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw err;
  }
}

// 批量嵌入：按 provider 的批量上限（阿里云百炼 v3/v4 为 10 条）分批；失败只标记该批为 failed
export async function embedChunks({ db, config, embedder, chunks }) {
  if (chunks.length === 0) return { ready: 0, failed: 0, error: null };
  if (!embedder.available()) {
    const message = "嵌入服务未配置（EMBEDDING_PROVIDER/BASE_URL/API_KEY）";
    const mark = db.prepare("UPDATE knowledge_chunks SET index_status = 'failed', embed_error = ? WHERE id = ?");
    for (const c of chunks) mark.run(message, c.id);
    return { ready: 0, failed: chunks.length, error: message };
  }

  const batchSize = Math.max(1, config.embeddingBatchSize);
  const markReady = db.prepare(
    "UPDATE knowledge_chunks SET index_status = 'ready', embedding = ?, embedding_dim = ?, embedding_model = ?, embed_error = NULL WHERE id = ?"
  );
  const markFailed = db.prepare(
    "UPDATE knowledge_chunks SET index_status = 'failed', embed_error = ? WHERE id = ?"
  );

  let ready = 0;
  let failed = 0;
  let error = null;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    try {
      const vectors = await embedder.embed(batch.map((c) => c.text));
      for (let j = 0; j < batch.length; j += 1) {
        markReady.run(JSON.stringify(vectors[j]), vectors[j].length, embedder.model, batch[j].id);
        ready += 1;
      }
    } catch (err) {
      error = err.message;
      for (const c of batch) {
        markFailed.run(String(err.message).slice(0, 300), c.id);
        failed += 1;
      }
    }
  }
  return { ready, failed, error };
}

// 启动时补齐：没有任何切片的材料按默认策略建立索引（种子材料也走这里）
export async function backfillIndex({ db, config, embedder, log = () => {} }) {
  // 需要建索引的材料：没有切片、切片全部失败、或向量来自别的嵌入模型（换模型必须重建）
  const pendingMaterials = db
    .prepare(
      "SELECT m.* FROM materials m WHERE " +
        "  NOT EXISTS (SELECT 1 FROM knowledge_chunks kc WHERE kc.material_id = m.id) " +
        "  OR NOT EXISTS (SELECT 1 FROM knowledge_chunks kc WHERE kc.material_id = m.id AND kc.index_status = 'ready') " +
        "  OR NOT EXISTS (SELECT 1 FROM knowledge_chunks kc WHERE kc.material_id = m.id AND kc.embedding_model = ?) " +
        "ORDER BY m.id"
    )
    .all(embedder.model);
  if (pendingMaterials.length === 0) return { materials: 0, chunks: 0, ready: 0, failed: 0 };

  let chunks = 0;
  let ready = 0;
  let failed = 0;
  for (const material of pendingMaterials) {
    const result = await reindexMaterial({ db, config, embedder, material });
    chunks += result.chunkCount;
    ready += result.ready;
    failed += result.failed;
    log("[index] 材料 #" + material.id + "《" + material.title + "》按 " + result.strategy + " 切分为 " + result.chunkCount + " 片，嵌入成功 " + result.ready + "、失败 " + result.failed);
  }
  return { materials: pendingMaterials.length, chunks, ready, failed };
}
