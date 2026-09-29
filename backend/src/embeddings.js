// 嵌入模块：把文本转成向量。
// provider = openai：任意 OpenAI 兼容的 /embeddings 服务（阿里云百炼、硅基流动、Ollama、课程网关…）
// provider = local ：本地确定性伪向量，仅用于没有密钥时跑通链路，不具备真正的语义能力
import { createHash } from "node:crypto";

export function createEmbeddingProvider(config) {
  if (config.embeddingProvider === "openai") {
    return {
      kind: "openai",
      model: config.embeddingModel,
      dim: config.embeddingDim,
      available: () => Boolean(config.embeddingBaseUrl && config.embeddingApiKey),
      async embed(texts) {
        if (!config.embeddingBaseUrl || !config.embeddingApiKey) {
          const err = new Error("嵌入服务未配置：缺少 EMBEDDING_BASE_URL 或 EMBEDDING_API_KEY");
          err.code = "EMBEDDING_NOT_CONFIGURED";
          throw err;
        }
        const url = config.embeddingBaseUrl.replace(/\/$/, "") + "/embeddings";
        const body = { model: config.embeddingModel, input: texts };
        // 阿里云百炼的 v3/v4 支持 dimensions，用于把维度固定到与库中已有向量一致
        if (config.embeddingDim) body.dimensions = config.embeddingDim;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.embeddingApiKey },
          body: JSON.stringify(body)
        });
        const text = await res.text();
        if (!res.ok) {
          const err = new Error("嵌入服务返回 " + res.status + "：" + text.slice(0, 300));
          err.code = "EMBEDDING_FAILED";
          throw err;
        }
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          throw Object.assign(new Error("嵌入服务返回的不是 JSON"), { code: "EMBEDDING_FAILED" });
        }
        const vectors = (json.data ?? []).map((d) => d.embedding);
        if (vectors.length !== texts.length || !vectors.every(Array.isArray)) {
          throw Object.assign(new Error("嵌入服务返回的向量数量与输入不一致"), { code: "EMBEDDING_FAILED" });
        }
        return vectors;
      }
    };
  }

  // ---- 本地伪向量：按字符 2-gram 哈希到固定维度，L2 归一化 ----
  const dim = config.embeddingDim || 1024;
  return {
    kind: "local",
    model: "local-hash-" + dim,
    dim,
    available: () => true,
    async embed(texts) {
      return texts.map((t) => localVector(t, dim));
    }
  };
}

function localVector(text, dim) {
  const vec = new Float64Array(dim);
  const clean = String(text ?? "").replace(/[\s\p{P}]+/gu, "");
  const grams = [];
  for (let i = 0; i + 2 <= clean.length; i += 1) grams.push(clean.slice(i, i + 2));
  if (grams.length === 0) grams.push(clean || "空");
  for (const gram of grams) {
    const h = createHash("sha1").update(gram).digest();
    const idx = ((h[0] << 8) | h[1]) % dim;
    const sign = h[2] % 2 === 0 ? 1 : -1;
    vec[idx] += sign;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function toNgrams(text, n = 2) {
  const clean = String(text ?? "").replace(/[\s\p{P}]+/gu, "");
  const out = new Set();
  for (let i = 0; i + n <= clean.length; i += 1) out.add(clean.slice(i, i + n));
  return [...out];
}
