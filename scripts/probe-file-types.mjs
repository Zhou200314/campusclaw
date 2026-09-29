// 验证上传接口对不同类型文件的处理结果（作业分析用，运行后自动清理测试数据）
// 用法：node scripts/probe-file-types.mjs
import { DatabaseSync } from "node:sqlite";
import { unlink } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.CAMPUSCLAW_BASE_URL ?? "http://127.0.0.1:8080";
const projectRoot = path.resolve(import.meta.dirname, "..");
const dbPath = process.env.DB_PATH ?? path.join(projectRoot, "data", "campusclaw.db");
const uploadDir = process.env.UPLOAD_DIR ?? path.join(projectRoot, "uploads");
const teacherPassword = process.env.SEED_TEACHER_PASSWORD ?? "Teacher@123";

const login = await fetch(baseUrl + "/api/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "teacher01", password: teacherPassword })
});
const cookie = login.headers.getSetCookie()[0].split(";")[0];

// 真实 PNG：签名 + IHDR（宽高与位深含 NUL 字节）
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("IHDR", "latin1"),
  Buffer.from([0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x08, 0x06, 0x00, 0x00, 0x00]),
  Buffer.alloc(64, 0x9c)
]);
// 最小 PNG：只有签名与图形数据，开头 4 KB 内没有 NUL 字节
const PNG_NO_NUL = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(80, 0x9c)
]);
const PDF = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\nstream\n\x00\x01\x02binary\x00\nendstream\n%%EOF", "latin1");
// 真实 docx（zip 容器）前 4 KB 通常含 NUL 字节
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40, 0x77), Buffer.alloc(40, 0x00)]);
const DOCX_NO_NUL = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(80, 0x77)]);
const EXE = Buffer.concat([Buffer.from("MZ", "latin1"), Buffer.alloc(120, 0x00), Buffer.from("This program cannot be run in DOS mode", "latin1")]);

const cases = [
  ["A 白名单", "notes.md", Buffer.from("# 标题\n\n这是 UTF-8 文本。", "utf8")],
  ["A 白名单", "data.csv", Buffer.from("姓名,分数\n张三,95\n", "utf8")],
  ["A 白名单", "page.html", Buffer.from("<h1>标题</h1>", "utf8")],
  ["B 内容嗅探", "weird.xyz", Buffer.from("未知扩展名但内容是纯文本。", "utf8")],
  ["B 内容嗅探", "noext", Buffer.from("没有扩展名的纯文本。", "utf8")],
  ["C 二进制", "photo.png", PNG],
  ["C 二进制", "report.pdf", PDF],
  ["C 二进制", "doc.docx", DOCX],
  ["C 二进制", "tool.exe", EXE],
  ["C 边界", "png-min.png", PNG_NO_NUL],
  ["C 边界", "docx-min.docx", DOCX_NO_NUL]
];

function multipart(filename, buffer, title) {
  const boundary = "----Probe" + Math.random().toString(16).slice(2);
  const head = Buffer.from(
    "--" + boundary + "\r\n" + 'Content-Disposition: form-data; name="title"' + "\r\n\r\n" + title + "\r\n" +
    "--" + boundary + "\r\n" + 'Content-Disposition: form-data; name="file"; filename="' + filename + '"' + "\r\n" +
    "Content-Type: application/octet-stream\r\n\r\n", "utf8");
  const tail = Buffer.from("\r\n--" + boundary + "--\r\n", "utf8");
  return { body: Buffer.concat([head, buffer, tail]), boundary };
}

console.log("档位".padEnd(12) + "文件".padEnd(14) + "HTTP".padEnd(6) + "extracted".padEnd(11) + "知识库正文（前 34 字符）");
console.log("-".repeat(96));

const createdIds = [];
for (const [tier, name, buffer] of cases) {
  const { body, boundary } = multipart(name, buffer, "类型探测-" + name);
  const res = await fetch(baseUrl + "/api/materials", {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=" + boundary, Cookie: cookie },
    body
  });
  const json = await res.json();
  const id = json.material?.id;
  if (!id) {
    console.log(tier.padEnd(12) + name.padEnd(14) + String(res.status).padEnd(6) + "-".padEnd(11) + JSON.stringify(json));
    continue;
  }
  createdIds.push(id);
  const detail = await fetch(baseUrl + "/api/materials/" + id, { headers: { Cookie: cookie } }).then((r) => r.json());
  const preview = JSON.stringify(detail.body).slice(0, 34);
  console.log(tier.padEnd(12) + name.padEnd(14) + String(res.status).padEnd(6) + String(json.knowledgeEntry.extracted).padEnd(11) + preview);
}

// 清理本次探测产生的数据与文件，保持演示库干净
const db = new DatabaseSync(dbPath);
for (const id of createdIds) {
  const row = db.prepare("SELECT stored_path FROM materials WHERE id = ?").get(id);
  db.prepare("DELETE FROM knowledge_entries WHERE material_id = ?").run(id);
  db.prepare("DELETE FROM materials WHERE id = ?").run(id);
  if (row && row.stored_path) {
    try {
      await unlink(path.join(uploadDir, row.stored_path));
    } catch {}
  }
}
const left = db.prepare("SELECT COUNT(*) AS n FROM materials").get().n;
console.log("-".repeat(96));
console.log("探测结束，已清理 " + createdIds.length + " 条测试记录；当前材料表 " + left + " 行。");
db.close();
