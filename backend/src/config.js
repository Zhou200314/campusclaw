import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// 配置外置：全部配置只从环境变量读取，仓库与镜像里不放真实值。
// .env 只用于本地开发，不入库；.env.example 列出全部必填项。

const REQUIRED_KEYS = ["SESSION_SECRET"];

function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const parsed = parseEnvFile(fs.readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function required(key) {
  const value = process.env[key];
  if (value === undefined || value.trim() === "") {
    const err = new Error("[config] 缺少必填环境变量 " + key + "，拒绝使用内置默认值，启动中止。");
    err.code = "CONFIG_MISSING";
    throw err;
  }
  return value;
}

function intFromEnv(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    const err = new Error("[config] 环境变量 " + key + " 必须是整数，当前值：" + raw);
    err.code = "CONFIG_INVALID";
    throw err;
  }
  return n;
}

function strFromEnv(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim();
}

export function loadConfig(options = {}) {
  const projectRoot = options.projectRoot ?? path.resolve(import.meta.dirname, "..", "..");
  const envPath = options.envPath ?? path.join(projectRoot, ".env");
  if (!options.skipEnvFile) loadEnvFile(envPath);

  const sessionSecret = required("SESSION_SECRET");
  if (sessionSecret.length < 16) {
    const err = new Error("[config] SESSION_SECRET 太短（至少 16 个字符），启动中止。");
    err.code = "CONFIG_INVALID";
    throw err;
  }

  return {
    projectRoot,
    host: strFromEnv("HOST", "127.0.0.1"),
    port: intFromEnv("PORT", 8080),
    dbPath: path.resolve(projectRoot, strFromEnv("DB_PATH", "./data/campusclaw.db")),
    uploadDir: path.resolve(projectRoot, strFromEnv("UPLOAD_DIR", "./uploads")),
    uploadMaxBytes: intFromEnv("UPLOAD_MAX_BYTES", 10 * 1024 * 1024),
    sessionSecret,
    sessionTtlSeconds: intFromEnv("SESSION_TTL_SECONDS", 2 * 60 * 60),
    loginFailThreshold: intFromEnv("LOGIN_FAIL_THRESHOLD", 5),
    loginLockSeconds: intFromEnv("LOGIN_LOCK_SECONDS", 60),
    // ---- 第 4 课：检索相关配置 ----
    // 嵌入 provider：openai = 任意 OpenAI 兼容服务（阿里云百炼 / 硅基流动 / Ollama / 课程网关）；local = 本地确定性伪向量（仅离线自测）
    embeddingProvider: strFromEnv("EMBEDDING_PROVIDER", "local"),
    embeddingBaseUrl: strFromEnv("EMBEDDING_BASE_URL", ""),
    embeddingApiKey: strFromEnv("EMBEDDING_API_KEY", ""),
    embeddingModel: strFromEnv("EMBEDDING_MODEL", "text-embedding-v4"),
    embeddingDim: intFromEnv("EMBEDDING_DIM", 1024),
    embeddingBatchSize: intFromEnv("EMBEDDING_BATCH_SIZE", 10),
    // 对话 provider：openai = OpenAI 兼容 chat/completions；local = 无模型时按切片拼出摘录式回答
    chatProvider: strFromEnv("CHAT_PROVIDER", "local"),
    chatBaseUrl: strFromEnv("CHAT_BASE_URL", ""),
    chatApiKey: strFromEnv("CHAT_API_KEY", ""),
    chatModel: strFromEnv("CHAT_MODEL", "qwen-plus"),
    chatTimeoutMs: intFromEnv("CHAT_TIMEOUT_MS", 60000),
    // 检索参数（与课件规约一致）
    vectorMinScore: Number(strFromEnv("VECTOR_MIN_SCORE", "0.35")),
    rrfK: intFromEnv("RRF_K", 60),
    retrieveTopK: intFromEnv("RETRIEVE_TOP_K", 10),
    askTopK: intFromEnv("ASK_TOP_K", 4),
    chunkMaxChars: intFromEnv("CHUNK_MAX_CHARS", 800),
    chunkOverlapChars: intFromEnv("CHUNK_OVERLAP_CHARS", 80),
    // 跨班可见开关：
    //   0（默认，课程要求）= 跨班完全隔离，列表看不到、按 ID 访问与下载一律 404
    //   1（演示模式）    = 材料列表可以看到其他班级的材料标题，但正文与下载被拒绝（403）
    crossClassVisible: process.env.CROSS_CLASS_VISIBLE === "1",
    // 置于反向代理（如 compose 里的 nginx）之后时设为 1，限流才能按真实客户端 IP 计数
    trustProxy: process.env.TRUST_PROXY === "1",
    seedTeacherPassword: process.env.SEED_TEACHER_PASSWORD ?? "",
    seedStudentPassword: process.env.SEED_STUDENT_PASSWORD ?? ""
  };
}

export const COOKIE_NAME = "cc_session";
