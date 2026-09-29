import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import { requireAuth, requireRole, UNAUTHENTICATED_BODY } from "./auth.js";
import { nowIso } from "./db.js";
import { extractText } from "./knowledge.js";
import { reindexMaterial, chunkOptionsFromFields } from "./indexing.js";

// 角色能力边界：教师可上传，学生仅可查看与下载（学生调用上传接口返回 403）。
const FORBIDDEN_BODY = { error: { code: "FORBIDDEN", message: "当前角色无权上传材料" } };
const NOT_FOUND_BODY = { error: { code: "NOT_FOUND", message: "材料不存在" } };

// busboy 默认按 latin1 解析 multipart 的 filename 参数，中文文件名会变成乱码；
// 这里把字节按 UTF-8 还原一次；若还原结果出现替换字符，说明原值已是合法文本，保持原样。
function decodeMultipartFilename(name) {
  const raw = String(name ?? "");
  const decoded = Buffer.from(raw, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? raw : decoded;
}

// 截断时保留扩展名，避免超长文件名丢掉类型信息。
function truncateKeepingExtension(name, max = 120) {
  if (name.length <= max) return name;
  const ext = path.extname(name).slice(0, 20);
  return name.slice(0, Math.max(1, max - ext.length)) + ext;
}

function safeFilename(name) {
  const base = path.basename(decodeMultipartFilename(name));
  const cleaned = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
  return truncateKeepingExtension(cleaned) || "upload.bin";
}

export function createUploadRouter({ db, config, embedder }) {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.uploadMaxBytes, files: 1 }
  });

  function uploadSingle(req, res, next) {
    upload.single("file")(req, res, (err) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: {
            code: "FILE_TOO_LARGE",
            message: "文件超过大小上限（" + config.uploadMaxBytes + " 字节）"
          }
        });
      }
      return res.status(400).json({ error: { code: "UPLOAD_INVALID", message: "上传数据无效" } });
    });
  }

  router.post("/api/materials", requireAuth, requireRole("teacher"), uploadSingle, async (req, res, next) => {
    const file = req.file;
    if (!file || !file.buffer || file.buffer.length === 0) {
      return res.status(400).json({ error: { code: "FILE_REQUIRED", message: "请选择要上传的文件" } });
    }

    const originalName = safeFilename(file.originalname);
    const rawTitle = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const title = (rawTitle || originalName).slice(0, 160);

    // 落盘路径：uploads/<classId>/<随机前缀>-<原文件名>，文件名做净化，避免路径穿越。
    const classDir = path.join(config.uploadDir, String(req.user.classId));
    const storedName = crypto.randomUUID() + "-" + originalName;
    const absolutePath = path.join(classDir, storedName);

    try {
      fs.mkdirSync(classDir, { recursive: true });
      fs.writeFileSync(absolutePath, file.buffer);
    } catch (err) {
      return next(err);
    }

    const extracted = extractText(file.buffer, originalName);
    const createdAt = nowIso();
    const relativePath = path.relative(config.uploadDir, absolutePath);

    let materialId;
    let knowledgeId;
    try {
      // 双表同事务：材料表与知识库表要么各写一行，要么都不写。
      db.exec("BEGIN IMMEDIATE");
      const material = db
        .prepare(
          "INSERT INTO materials (class_id, title, body, filename, uploaded_by, created_at, stored_path, size_bytes, mime_type) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          req.user.classId,
          title,
          extracted.body,
          originalName,
          req.user.id,
          createdAt,
          relativePath,
          file.buffer.length,
          file.mimetype ?? "application/octet-stream"
        );
      materialId = Number(material.lastInsertRowid);

      const entry = db
        .prepare(
          "INSERT INTO knowledge_entries (material_id, class_id, title, body, source, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(materialId, req.user.classId, title, extracted.body, originalName, createdAt);
      knowledgeId = Number(entry.lastInsertRowid);
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      // 事务失败时同时清理已落盘的文件，避免出现“只有文件没有记录”的孤儿。
      try {
        fs.unlinkSync(absolutePath);
      } catch {}
      return next(err);
    }

    // 事务已提交：材料与知识库条目一定存在；下面做切分与向量嵌入，
    // 嵌入失败只把切片标记为 failed，材料与原文不受影响（与课件规约一致）。
    let index = null;
    let indexError = null;
    try {
      index = await reindexMaterial({
        db,
        config,
        embedder,
        material: { id: materialId, class_id: req.user.classId, title },
        options: chunkOptionsFromFields(req.body)
      });
    } catch (err) {
      indexError = err.message;
    }

    return res.status(201).json({
      index: index
        ? {
            strategy: index.strategy,
            chunk_count: index.chunkCount,
            ready: index.ready,
            failed: index.failed,
            embed_error: index.embedError
          }
        : { error: indexError },
      material: {
        id: materialId,
        title,
        filename: originalName,
        sizeBytes: file.buffer.length,
        classId: req.user.classId,
        uploadedBy: req.user.displayName,
        createdAt
      },
      knowledgeEntry: {
        id: knowledgeId,
        materialId,
        extracted: extracted.extracted,
        note: extracted.note
      }
    });
  });

  // 下载同样走鉴权与班级隔离：
  //   跨班可见关闭（默认）= 跨班与不存在同形返回 404，不泄露对方有任何材料；
  //   跨班可见打开       = 列表能看到别班材料，但下载明确返回 403（看得到、拿不走）。
  router.get("/api/materials/:id/download", requireAuth, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(404).json(NOT_FOUND_BODY);

    const row = db.prepare("SELECT * FROM materials WHERE id = ?").get(id);
    if (!row) return res.status(404).json(NOT_FOUND_BODY);
    if (row.class_id !== req.user.classId) {
      if (config.crossClassVisible) {
        return res.status(403).json({
          error: { code: "DOWNLOAD_FORBIDDEN", message: "无权下载其他班级的材料" }
        });
      }
      return res.status(404).json(NOT_FOUND_BODY);
    }
    if (!row.stored_path) return res.status(404).json(NOT_FOUND_BODY);

    const absolutePath = path.join(config.uploadDir, row.stored_path);
    if (!fs.existsSync(absolutePath)) return res.status(404).json(NOT_FOUND_BODY);

    return res.download(absolutePath, row.filename ?? "material.bin");
  });

  return router;
}

export { FORBIDDEN_BODY, NOT_FOUND_BODY, UNAUTHENTICATED_BODY };
