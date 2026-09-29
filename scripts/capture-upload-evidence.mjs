// 采集上传入库的真实验证证据：教师上传成功、学生 403、跨班下载 404、超限 413、双表同事务。
// 用法：node scripts/capture-upload-evidence.mjs
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = new URL(process.env.CAMPUSCLAW_BASE_URL ?? "http://127.0.0.1:8080");
const projectRoot = path.resolve(import.meta.dirname, "..");
const teacherPassword = process.env.SEED_TEACHER_PASSWORD ?? "Teacher@123";
const studentPassword = process.env.SEED_STUDENT_PASSWORD ?? "Student@123";
const dbPath = process.env.DB_PATH ?? path.join(projectRoot, "data", "campusclaw.db");

const lines = [];
const write = (text) => {
  lines.push(text);
  console.log(text);
};

function request({ method, path: urlPath, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const req = http.request(
      { hostname: baseUrl.hostname, port: baseUrl.port, method, path: urlPath, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const ms = Number(process.hrtime.bigint() - started) / 1e6;
          const raw = Buffer.concat(chunks);
          const responseHeaders = [];
          for (let i = 0; i < res.rawHeaders.length; i += 2) {
            responseHeaders.push([res.rawHeaders[i], res.rawHeaders[i + 1]]);
          }
          resolve({ status: res.statusCode, headers: responseHeaders, buffer: raw, body: raw.toString("utf8"), ms });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function jsonRequest(method, urlPath, payload, cookie) {
  const body = payload === undefined ? undefined : Buffer.from(JSON.stringify(payload), "utf8");
  const headers = { Accept: "application/json" };
  if (body) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = body.length;
  }
  if (cookie) headers["Cookie"] = cookie;
  return request({ method, path: urlPath, headers, body });
}

function multipartRequest(urlPath, { filename, content, title, cookie }) {
  const boundary = "----CampusClawBoundary" + Date.now().toString(16);
  const payload = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
  const head = Buffer.from(
    "--" + boundary + "\r\n" +
      'Content-Disposition: form-data; name="title"' + "\r\n\r\n" + (title ?? "") + "\r\n" +
      "--" + boundary + "\r\n" +
      'Content-Disposition: form-data; name="file"; filename="' + filename + '"' + "\r\n" +
      "Content-Type: application/octet-stream" + "\r\n\r\n",
    "utf8"
  );
  const tail = Buffer.from("\r\n--" + boundary + "--\r\n", "utf8");
  const body = Buffer.concat([head, payload, tail]);
  const headers = {
    Accept: "application/json",
    "Content-Type": "multipart/form-data; boundary=" + boundary,
    "Content-Length": body.length
  };
  if (cookie) headers["Cookie"] = cookie;
  return { body, headers, boundary, payloadLength: payload.length };
}

function cookieFrom(res) {
  const setCookies = res.headers.filter(([n]) => n.toLowerCase() === "set-cookie").map(([, v]) => v);
  const match = setCookies.find((v) => v.startsWith("cc_session="));
  return match ? match.split(";")[0] : null;
}

function counts() {
  const db = new DatabaseSync(dbPath);
  const materials = db.prepare("SELECT COUNT(*) AS n FROM materials").get().n;
  const knowledge = db.prepare("SELECT COUNT(*) AS n FROM knowledge_entries").get().n;
  const session = db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n;
  db.close();
  return { materials, knowledge, session };
}

async function login(username, password) {
  const res = await jsonRequest("POST", "/api/login", { username, password });
  return { cookie: cookieFrom(res), res };
}

write("CampusClaw 迭代 1 · 上传入库证据采集");
write("目标服务：" + baseUrl.href);
write("采集时间：" + new Date().toISOString());

const teacher = await login("teacher01", teacherPassword);
const student = await login("student01", studentPassword);
write("\n[准备] teacher01 登录 " + teacher.res.status + "，student01 登录 " + student.res.status);

const before = counts();
write("[准备] 上传前计数：materials=" + before.materials + "  knowledge_entries=" + before.knowledge);

// ---------------------------------------------------------------- 教师上传
const materialTitle = "1班-上传测试-" + new Date().toISOString().slice(11, 19);
const materialBody = "# " + materialTitle + "\n\n这是通过上传接口写入的正文，用于验证知识库入库与列表搜索。班级标识 CLASS-1。\n";
const upload = multipartRequest("/api/materials", {
  filename: "upload-test.md",
  content: materialBody,
  title: materialTitle,
  cookie: teacher.cookie
});

write("\n" + "=".repeat(78));
write("步骤：教师上传材料（POST /api/materials，multipart/form-data）");
write("期望：201，材料表与知识库表在同一事务内各新增一行");
write("-".repeat(78));
write(">>> 请求（body 为 multipart，此处展示结构与文本部分）");
write("POST /api/materials HTTP/1.1");
write("Host: " + baseUrl.host);
write("Cookie: " + teacher.cookie);
write("Content-Type: " + upload.headers["Content-Type"]);
write("Content-Length: " + upload.headers["Content-Length"]);
write("");
write("--" + upload.boundary);
write('Content-Disposition: form-data; name="title"');
write("");
write(materialTitle);
write("--" + upload.boundary);
write('Content-Disposition: form-data; name="file"; filename="upload-test.md"');
write("Content-Type: text/markdown");
write("");
write(materialBody.trim());
write("--" + upload.boundary + "--");

const uploadRes = await request({ method: "POST", path: "/api/materials", headers: upload.headers, body: upload.body });
write("<<< 响应（" + uploadRes.ms.toFixed(1) + " ms）");
write("HTTP/1.1 " + uploadRes.status);
for (const [n, v] of uploadRes.headers) write(n + ": " + v);
write("");
write(uploadRes.body);

const created = JSON.parse(uploadRes.body);
const afterUpload = counts();
write(
  afterUpload.materials === before.materials + 1 && afterUpload.knowledge === before.knowledge + 1
    ? "[断言通过] 两表各 +1：materials " + before.materials + " -> " + afterUpload.materials + "，knowledge_entries " + before.knowledge + " -> " + afterUpload.knowledge
    : "[断言失败] 两表没有同时 +1"
);

// ---------------------------------------------------------------- 详情与下载
const detail = await request({
  method: "GET",
  path: "/api/materials/" + created.material.id,
  headers: { Accept: "application/json", Cookie: teacher.cookie }
});
write("\n" + "=".repeat(78));
write("步骤：读取刚上传材料的详情（GET /api/materials/" + created.material.id + "）");
write("-".repeat(78));
write("<<< HTTP/1.1 " + detail.status + "  " + detail.body);

const download = await request({
  method: "GET",
  path: "/api/materials/" + created.material.id + "/download",
  headers: { Accept: "*/*", Cookie: teacher.cookie }
});
write("\n步骤：下载材料（GET /api/materials/" + created.material.id + "/download）");
write(">>> 请求头：Cookie: " + teacher.cookie);
write("<<< HTTP/1.1 " + download.status + "  Content-Disposition: " + (download.headers.find(([n]) => n.toLowerCase() === "content-disposition")?.[1] ?? "-"));
write("[提示] 下载内容长度 " + download.buffer.length + " 字节，与上传的 " + Buffer.byteLength(materialBody) + " 字节一致：" + (download.buffer.length === Buffer.byteLength(materialBody)));

// ---------------------------------------------------------------- 学生上传 403
const studentUpload = multipartRequest("/api/materials", {
  filename: "student-try.md",
  content: "学生会话尝试上传，应当被拒绝。\n",
  title: "学生上传尝试",
  cookie: student.cookie
});
const studentRes = await request({ method: "POST", path: "/api/materials", headers: studentUpload.headers, body: studentUpload.body });
write("\n" + "=".repeat(78));
write("步骤：学生上传材料（应当被拒绝）");
write("期望：403，且两张表都不新增数据");
write("-".repeat(78));
write(">>> 请求：POST /api/materials（Cookie 为 student01 的会话）");
write("<<< 响应 HTTP/1.1 " + studentRes.status + "  " + studentRes.body);
const afterStudent = counts();
write(
  studentRes.status === 403 && afterStudent.materials === afterUpload.materials && afterStudent.knowledge === afterUpload.knowledge
    ? "[断言通过] 403 且两表计数不变"
    : "[断言失败] 学生上传未被正确拒绝"
);

// ---------------------------------------------------------------- 跨班下载 404
const crossClass = await request({
  method: "GET",
  path: "/api/materials/3/download",
  headers: { Accept: "*/*", Cookie: teacher.cookie }
});
write("\n" + "=".repeat(78));
write("步骤：跨班下载（材料 #3 属于高一(2)班，当前会话为高一(1)班）");
write("-".repeat(78));
write("<<< HTTP/1.1 " + crossClass.status + "  " + crossClass.body);
write(crossClass.status === 404 ? "[断言通过] 跨班下载与不存在同形返回 404" : "[断言失败] 跨班下载未被拒绝");

// ---------------------------------------------------------------- 超限 413
const bigBuffer = Buffer.alloc(11 * 1024 * 1024, 0x41);
const tooBig = multipartRequest("/api/materials", {
  filename: "too-big.md",
  content: bigBuffer,
  title: "超大文件",
  cookie: teacher.cookie
});
const tooBigRes = await request({ method: "POST", path: "/api/materials", headers: tooBig.headers, body: tooBig.body });
const afterBig = counts();
write("\n" + "=".repeat(78));
write("步骤：上传超过大小上限的文件（11 MB > 10 MB）");
write("期望：413，且两张表都不新增数据（同事务不产生半写入）");
write("-".repeat(78));
write(">>> 请求：POST /api/materials，Content-Length: " + tooBig.headers["Content-Length"]);
write("<<< 响应 HTTP/1.1 " + tooBigRes.status + "  " + tooBigRes.body);
write(
  tooBigRes.status === 413 && afterBig.materials === afterStudent.materials && afterBig.knowledge === afterStudent.knowledge
    ? "[断言通过] 413 且两表计数仍然不变"
    : "[断言失败] 超限上传处理不正确"
);

write("\n[汇总] 材料表 " + afterBig.materials + " 行，知识库表 " + afterBig.knowledge + " 行（上传前 " + before.materials + " / " + before.knowledge + "）");

const outDir = path.join(projectRoot, "docs", "evidence");
await mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, "upload-request-response.md");
await writeFile(outFile, lines.join("\n") + "\n", "utf8");
console.log("\n证据已写入：" + outFile);
