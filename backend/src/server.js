import fs from "node:fs";
import process from "node:process";
import { loadConfig } from "./config.js";
import { openDatabase, migrate } from "./db.js";
import { seedDatabase } from "./seed.js";
import { createApp } from "./app.js";
import { createEmbeddingProvider } from "./embeddings.js";
import { createChatProvider } from "./ask.js";
import { backfillIndex } from "./indexing.js";

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    // 失败即停：配置缺失或非法时直接退出，不落到内置默认值。
    console.error(err.message);
    process.exit(1);
  }
  config.logRequests = process.env.LOG_REQUESTS !== "0";

  fs.mkdirSync(config.uploadDir, { recursive: true });
  const db = openDatabase(config.dbPath);
  migrate(db);

  try {
    const result = seedDatabase(db, config);
    if (result.seeded) {
      console.log("[seed] 已写入种子数据：班级 " + result.classes + " 个，账号 " + result.users + " 个，材料 " + result.materials + " 条");
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  // 检索与问答使用的两个 provider（可切换为任意 OpenAI 兼容服务）
  const embedder = createEmbeddingProvider(config);
  const chat = createChatProvider(config);
  const app = createApp({ db, config, embedder, chat });
  const server = app.listen(config.port, config.host, () => {
    console.log("");
    console.log("CampusClaw 迭代 1 已启动");
    console.log("  地址      http://" + config.host + ":" + config.port + "/");
    console.log("  数据库    " + config.dbPath);
    console.log("  上传目录  " + config.uploadDir + "（上限 " + Math.round(config.uploadMaxBytes / 1048576) + " MB）");
    console.log("  会话 TTL  " + config.sessionTtlSeconds + " 秒");
    console.log("  嵌入模型  " + embedder.kind + " / " + embedder.model + (embedder.available() ? "" : "（未配置密钥，向量检索将返回 503）"));
    console.log("  对话模型  " + chat.kind + " / " + chat.model);
    console.log("  演示账号  teacher01 / student01（高一(1)班）  teacher02 / student02（高一(2)班）");
    console.log("  口令      teacher = <SEED_TEACHER_PASSWORD>   student = <SEED_STUDENT_PASSWORD>");
    console.log("");
  });

  // 启动后补齐索引：没有任何切片的材料按默认策略切分并嵌入（种子材料也走这里）
  backfillIndex({ db, config, embedder, log: (line) => console.log(line) })
    .then((result) => {
      if (result.materials > 0) {
        console.log(
          "[index] 索引补齐完成：材料 " + result.materials + " 份，切片 " + result.chunks + " 条（成功 " + result.ready + "，失败 " + result.failed + "）"
        );
      }
    })
    .catch((err) => console.error("[index] 索引补齐失败：" + err.message));

  const shutdown = () => {
    server.close(() => {
      try {
        db.close();
      } catch {}
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
