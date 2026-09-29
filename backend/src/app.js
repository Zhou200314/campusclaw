import express from "express";
import fs from "node:fs";
import path from "node:path";
import { createAuthRouter, sessionMiddleware } from "./auth.js";
import { createMaterialsRouter } from "./materials.js";
import { createUploadRouter } from "./uploads.js";
import { createSearchRouter } from "./search-routes.js";
import { createEmbeddingProvider } from "./embeddings.js";
import { createChatProvider } from "./ask.js";

function requestLogger(config) {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      if (!config.logRequests) return;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      console.log(
        "[http] " + req.method + " " + req.originalUrl + " -> " + res.statusCode + " (" + ms.toFixed(1) + "ms)"
      );
    });
    next();
  };
}

export function createApp({ db, config, embedder, chat }) {
  const embeddingProvider = embedder ?? createEmbeddingProvider(config);
  const chatProvider = chat ?? createChatProvider(config);
  const app = express();
  app.disable("x-powered-by");
  // 反向代理之后：按 X-Forwarded-For 解析真实客户端 IP，限流才有意义
  if (config.trustProxy) app.set("trust proxy", 1);
  app.use(express.json({ limit: "1mb" }));
  app.use(requestLogger(config));
  app.use(sessionMiddleware(db));
  app.use(createAuthRouter({ db, config }));
  app.use(createSearchRouter({ db, config, embedder: embeddingProvider, chat: chatProvider }));
  app.use(createUploadRouter({ db, config, embedder: embeddingProvider }));
  app.use(createMaterialsRouter({ db, config }));

  app.use("/api", (req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "接口不存在" } });
  });

  const distDir = path.join(config.projectRoot, "frontend", "dist");
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir, { index: false }));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      return res.sendFile(path.join(distDir, "index.html"));
    });
  } else {
    app.get("*", (req, res) => {
      res
        .status(503)
        .type("text/plain")
        .send("前端尚未构建。请先执行：npm --prefix frontend install && npm --prefix frontend run build");
    });
  }

  app.use((err, req, res, next) => {
    console.error("[error]", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "服务器内部错误" } });
  });

  app.locals.embedder = embeddingProvider;
  app.locals.chat = chatProvider;
  return app;
}
