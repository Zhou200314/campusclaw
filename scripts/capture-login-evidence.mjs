// 采集登录接口的真实请求参数与响应原文，作为作业证据。
// 用法：node scripts/capture-login-evidence.mjs [baseUrl]
import http from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = new URL(process.argv[2] ?? process.env.CAMPUSCLAW_BASE_URL ?? "http://127.0.0.1:8080");
const teacherPassword = process.env.SEED_TEACHER_PASSWORD ?? "Teacher@123";
const studentPassword = process.env.SEED_STUDENT_PASSWORD ?? "Student@123";

const lines = [];
function write(text) {
  lines.push(text);
  console.log(text);
}

function request({ method, path: urlPath, body, cookie }) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers = {};
  if (payload !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(payload);
  }
  headers["Accept"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;

  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const req = http.request(
      {
        hostname: baseUrl.hostname,
        port: baseUrl.port,
        method,
        path: urlPath,
        headers
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const ms = Number(process.hrtime.bigint() - started) / 1e6;
          const raw = Buffer.concat(chunks);
          const responseHeaders = [];
          for (let i = 0; i < res.rawHeaders.length; i += 2) {
            responseHeaders.push([res.rawHeaders[i], res.rawHeaders[i + 1]]);
          }
          resolve({
            status: res.statusCode,
            statusMessage: res.statusMessage,
            headers: responseHeaders,
            body: raw.toString("utf8"),
            ms
          });
        });
      }
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function formatRequest(method, urlPath, body, cookie) {
  const out = [];
  out.push(method + " " + urlPath + " HTTP/1.1");
  out.push("Host: " + baseUrl.host);
  if (body !== undefined) {
    out.push("Content-Type: application/json");
    out.push("Content-Length: " + Buffer.byteLength(JSON.stringify(body)));
  }
  out.push("Accept: application/json");
  if (cookie) out.push("Cookie: " + cookie);
  if (body !== undefined) {
    out.push("");
    out.push(JSON.stringify(body));
  }
  return out.join("\n");
}

function formatResponse(res) {
  const out = [];
  out.push("HTTP/1.1 " + res.status + " " + (res.statusMessage ?? ""));
  for (const [name, value] of res.headers) out.push(name + ": " + value);
  out.push("");
  out.push(res.body === "" ? "(空响应体)" : res.body);
  return out.join("\n");
}

function maskCookie(setCookieValues) {
  return setCookieValues
    .map((value) => String(value).split(";")[0])
    .join("; ");
}

let sessionCookie = null;
let sessionId = null;

async function step(title, { method, path: urlPath, body, cookie, expect }) {
  write("\n" + "=".repeat(78));
  write("步骤：" + title);
  write("期望：" + expect);
  write("-".repeat(78));
  write(">>> 请求");
  write(formatRequest(method, urlPath, body, cookie));
  const res = await request({ method, path: urlPath, body, cookie });
  write("<<< 响应（" + res.ms.toFixed(1) + " ms）");
  write(formatResponse(res));
  return res;
}

write("CampusClaw 迭代 1 · 登录与会话证据采集");
write("目标服务：" + baseUrl.href);
write("采集时间：" + new Date().toISOString());

const wrong = await step("用错误口令登录（teacher01 + wrong-password）", {
  method: "POST",
  path: "/api/login",
  body: { username: "teacher01", password: "wrong-password" },
  expect: "401，统一失败提示，响应体不区分用户是否存在"
});

const unknown = await step("用不存在的账号登录（nosuchuser）", {
  method: "POST",
  path: "/api/login",
  body: { username: "nosuchuser", password: teacherPassword },
  expect: "401，响应体与上一步完全一致（防账号枚举）"
});

if (unknown.body !== wrong.body) {
  write("\n[断言失败] 两次失败响应体不一致：账号枚举防护未生效");
  process.exitCode = 1;
} else {
  write("\n[断言通过] 用户不存在与口令错误的响应体完全一致");
}

const success = await step("用正确口令登录（teacher01）", {
  method: "POST",
  path: "/api/login",
  body: { username: "teacher01", password: teacherPassword },
  expect: "200，返回角色与班级，并通过 Set-Cookie 下发会话 Cookie"
});

const setCookies = success.headers.filter(([name]) => name.toLowerCase() === "set-cookie").map(([, value]) => value);
sessionCookie = maskCookie(setCookies);
sessionId = sessionCookie.replace("cc_session=", "");
write("\n[提示] 会话 Cookie：" + sessionCookie);
write("[提示] Set-Cookie 属性：" + setCookies.join(" | "));

await step("携带会话 Cookie 读取当前身份（GET /api/me）", {
  method: "GET",
  path: "/api/me",
  cookie: sessionCookie,
  expect: "200，角色与班级来自服务端会话"
});

await step("携带会话 Cookie 读取本班材料（GET /api/materials）", {
  method: "GET",
  path: "/api/materials",
  cookie: sessionCookie,
  expect: "200，只返回高一(1)班材料"
});

await step("跨班按 ID 访问（GET /api/materials/3，属于高一(2)班）", {
  method: "GET",
  path: "/api/materials/3",
  cookie: sessionCookie,
  expect: "404，不返回对方的标题与正文"
});

const student = await step("用学生账号登录（student01）", {
  method: "POST",
  path: "/api/login",
  body: { username: "student01", password: studentPassword },
  expect: "200，角色为 student"
});
const studentCookie = maskCookie(
  student.headers.filter(([name]) => name.toLowerCase() === "set-cookie").map(([, value]) => value)
);

await step("学生读取材料（GET /api/materials）", {
  method: "GET",
  path: "/api/materials",
  cookie: studentCookie,
  expect: "200，学生可查看本班材料"
});

await step("登出（POST /api/logout）", {
  method: "POST",
  path: "/api/logout",
  cookie: studentCookie,
  expect: "204，服务端删除会话并清除 Cookie"
});

await step("登出后用旧 Cookie 再访问（GET /api/me）", {
  method: "GET",
  path: "/api/me",
  cookie: studentCookie,
  expect: "401，旧 Cookie 立即失效"
});

await step("未登录访问受保护接口（GET /api/materials）", {
  method: "GET",
  path: "/api/materials",
  expect: "401，响应体不含任何材料标题或正文"
});


// ---------------------------------------------------------------- 防会话固定
write("\n" + "=".repeat(78));
write("步骤：已有会话时再次登录，验证换发新会话 ID（防会话固定）");
write("期望：会话 Cookie 值改变，且登录前的旧 Cookie 立即失效");
write("-".repeat(78));

const rotate = await request({
  method: "POST",
  path: "/api/login",
  body: { username: "teacher01", password: teacherPassword },
  cookie: sessionCookie
});
const rotatedCookies = rotate.headers
  .filter(([name]) => name.toLowerCase() === "set-cookie")
  .map(([, value]) => value);
const rotatedCookie = maskCookie(rotatedCookies);
write(">>> 携带旧 Cookie 再次登录：POST /api/login（teacher01）");
write("<<< 响应 " + rotate.status + "，新 Cookie：" + rotatedCookie);
write("旧 Cookie：" + sessionCookie);
write(rotatedCookie !== sessionCookie ? "[断言通过] 会话 ID 已换发" : "[断言失败] 会话 ID 未变化");

const staleCheck = await request({ method: "GET", path: "/api/me", cookie: sessionCookie });
write(">>> 用登录前的旧 Cookie 请求 GET /api/me");
write("<<< 响应 " + staleCheck.status + " " + (staleCheck.body || "(空)"));
write(staleCheck.status === 401 ? "[断言通过] 旧会话已作废" : "[断言失败] 旧会话仍可用");

// ---------------------------------------------------------------- 限流
write("\n" + "=".repeat(78));
write("步骤：连续失败触发登录限流（用户名 + IP 维度）");
write("期望：达到阈值后被锁定，锁定期内即使口令正确也返回与凭据错误一致的 401");
write("-".repeat(78));

const lockUsername = "teacher02";
let firstFailureBody = null;
for (let attempt = 1; attempt <= 5; attempt += 1) {
  const res = await request({
    method: "POST",
    path: "/api/login",
    body: { username: lockUsername, password: "wrong-password-" + attempt }
  });
  if (attempt === 1) firstFailureBody = res.body;
  write("第 " + attempt + " 次错误口令 -> " + res.status + " " + res.body);
}

const lockedCorrect = await request({
  method: "POST",
  path: "/api/login",
  body: { username: lockUsername, password: teacherPassword }
});
write("锁定期内使用正确口令 -> " + lockedCorrect.status + " " + lockedCorrect.body);
write(
  lockedCorrect.status === 401 && lockedCorrect.body === firstFailureBody
    ? "[断言通过] 锁定期响应与凭据错误完全同形，且不因口令正确而放行"
    : "[断言失败] 限流行为不符合预期"
);

export const evidence = { sessionId, sessionCookie };

const outDir = path.resolve(import.meta.dirname, "..", "docs", "evidence");
await mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, "login-request-response.md");
await writeFile(outFile, lines.join("\n") + "\n", "utf8");
console.log("\n证据已写入：" + outFile);
