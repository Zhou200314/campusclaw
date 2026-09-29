import express from "express";
import { requireAuth } from "./auth.js";

// 班级隔离：班级来自服务端会话（req.user.classId），请求参数无法指定班级。
// 当 config.crossClassVisible 打开时，列表会包含其他班级的材料，但只给标题等元数据，
// 正文与下载仍然拒绝（403），用于演示"看得到、拿不走"。
const NOT_FOUND_BODY = { error: { code: "NOT_FOUND", message: "材料不存在" } };

export function createMaterialsRouter({ db, config }) {
  const router = express.Router();
  const crossClassVisible = config?.crossClassVisible === true;

  router.get("/api/materials", requireAuth, (req, res) => {
    const keyword = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const like = "%" + keyword + "%";

    let rows;
    if (crossClassVisible) {
      const base =
        "SELECT m.id, m.class_id, m.title, m.filename, m.size_bytes, m.created_at, c.name AS class_name " +
        "FROM materials m JOIN classes c ON c.id = m.class_id ";
      rows = keyword
        ? db.prepare(base + "WHERE (m.title LIKE ? OR m.body LIKE ?) ORDER BY m.class_id, m.id").all(like, like)
        : db.prepare(base + "ORDER BY m.class_id, m.id").all();
    } else {
      const base =
        "SELECT id, class_id, title, filename, size_bytes, created_at FROM materials WHERE class_id = ? ";
      rows = keyword
        ? db.prepare(base + "AND (title LIKE ? OR body LIKE ?) ORDER BY id").all(req.user.classId, like, like)
        : db.prepare(base + "ORDER BY id").all(req.user.classId);
    }

    return res.status(200).json({
      classId: req.user.classId,
      className: req.user.className,
      canUpload: req.user.role === "teacher",
      crossClassVisible,
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        filename: row.filename,
        sizeBytes: row.size_bytes ?? null,
        createdAt: row.created_at,
        classId: row.class_id,
        className: row.class_name ?? null,
        sameClass: row.class_id === req.user.classId,
        canDownload: row.class_id === req.user.classId
      }))
    });
  });

  router.get("/api/materials/:id", requireAuth, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(404).json(NOT_FOUND_BODY);

    const row = db
      .prepare(
        "SELECT m.*, c.name AS class_name FROM materials m JOIN classes c ON c.id = m.class_id WHERE m.id = ?"
      )
      .get(id);

    // 关闭跨班可见时：跨班与不存在同形返回 404，不泄露对方标题与正文
    if (!row) return res.status(404).json(NOT_FOUND_BODY);
    const sameClass = row.class_id === req.user.classId;
    if (!sameClass && !crossClassVisible) return res.status(404).json(NOT_FOUND_BODY);

    const knowledge = db.prepare("SELECT id FROM knowledge_entries WHERE material_id = ?").get(row.id);

    // 跨班可见模式下只返回元数据，正文不下发
    if (!sameClass) {
      return res.status(200).json({
        id: row.id,
        title: row.title,
        filename: row.filename,
        sizeBytes: row.size_bytes ?? null,
        createdAt: row.created_at,
        classId: row.class_id,
        className: row.class_name,
        sameClass: false,
        canDownload: false,
        restricted: true,
        body: null,
        knowledgeEntryId: knowledge ? knowledge.id : null
      });
    }

    return res.status(200).json({
      id: row.id,
      title: row.title,
      body: row.body,
      filename: row.filename,
      sizeBytes: row.size_bytes ?? null,
      createdAt: row.created_at,
      classId: row.class_id,
      className: row.class_name,
      sameClass: true,
      canDownload: true,
      knowledgeEntryId: knowledge ? knowledge.id : null
    });
  });

  return router;
}
