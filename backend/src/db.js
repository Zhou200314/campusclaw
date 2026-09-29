import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// 数据层：单实例 SQLite，一次上传在同一个事务里写 materials 与 knowledge_entries。
// 需要换成 MySQL 时，只需替换本文件的连接与方言，上层仓储接口不变。

export function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

function hasColumn(db, table, column) {
  const rows = db.prepare("PRAGMA table_info(" + table + ")").all();
  return rows.some((row) => row.name === column);
}

function addColumnIfMissing(db, table, column, ddl) {
  if (!hasColumn(db, table, column)) {
    db.exec("ALTER TABLE " + table + " ADD COLUMN " + ddl);
  }
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS classes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL UNIQUE,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      display_name  TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
      class_id      INTEGER NOT NULL REFERENCES classes(id),
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id           TEXT PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at   TEXT NOT NULL,
      expires_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      username     TEXT NOT NULL,
      ip           TEXT NOT NULL,
      fail_count   INTEGER NOT NULL DEFAULT 0,
      first_fail_at TEXT NOT NULL,
      locked_until TEXT,
      PRIMARY KEY (username, ip)
    );

    CREATE TABLE IF NOT EXISTS materials (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id    INTEGER NOT NULL REFERENCES classes(id),
      title       TEXT NOT NULL,
      body        TEXT NOT NULL,
      filename    TEXT,
      uploaded_by INTEGER NOT NULL REFERENCES users(id),
      created_at  TEXT NOT NULL
    );

    -- 切片：检索的最小单位；chunk_text 是正文副本，char_start/char_end 指向预处理后文本的偏移
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      knowledge_entry_id INTEGER NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
      material_id        INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
      class_id           INTEGER NOT NULL REFERENCES classes(id),
      chunk_index        INTEGER NOT NULL,
      chunk_text         TEXT NOT NULL,
      char_start         INTEGER NOT NULL,
      char_end           INTEGER NOT NULL,
      strategy           TEXT NOT NULL,
      index_status       TEXT NOT NULL DEFAULT 'pending',   -- pending | ready | failed
      embedding          TEXT,                              -- JSON 浮点数组（本地向量后端）
      embedding_dim      INTEGER,
      embed_error        TEXT,
      created_at         TEXT NOT NULL,
      UNIQUE (knowledge_entry_id, chunk_index)
    );

    -- 2-gram 倒排索引：等价于课程里 MySQL FULLTEXT ... WITH PARSER ngram (token=2)
    CREATE TABLE IF NOT EXISTS chunk_grams (
      chunk_id  INTEGER NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
      gram      TEXT NOT NULL,
      PRIMARY KEY (chunk_id, gram)
    );

    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
      class_id    INTEGER NOT NULL REFERENCES classes(id),
      title       TEXT NOT NULL,
      body        TEXT NOT NULL,
      source      TEXT,
      created_at  TEXT NOT NULL
    );
  `);

  db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_class_status ON knowledge_chunks (class_id, index_status);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_material ON knowledge_chunks (material_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_grams_gram ON chunk_grams (gram);");

  // 兼容旧库：补充上传相关的列
  addColumnIfMissing(db, "knowledge_chunks", "embedding_model", "embedding_model TEXT");
  addColumnIfMissing(db, "materials", "stored_path", "stored_path TEXT");
  addColumnIfMissing(db, "materials", "size_bytes", "size_bytes INTEGER");
  addColumnIfMissing(db, "materials", "mime_type", "mime_type TEXT");
}

export function nowIso() {
  return new Date().toISOString();
}
