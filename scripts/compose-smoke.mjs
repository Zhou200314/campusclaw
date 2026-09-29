// Docker Compose 部署冒烟验证：构建启动 → 登录 → 上传 → down/up → 数据仍在
// 用法（在项目根目录，需要 Docker Desktop 已启动）：
//   node scripts/compose-smoke.mjs
import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";

const webUrl = process.env.SMOKE_WEB_URL ?? "http://127.0.0.1:8080";
const teacherPassword = process.env.SEED_TEACHER_PASSWORD ?? "Teacher@123";

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? "  [通过] " : "  [失败] ") + name + (detail ? "  → " + detail : ""));
}

function compose(args, { quiet = false } = {}) {
  const res = spawnSync("docker", ["compose", ...args], { stdio: quiet ? "pipe" : "inherit", encoding: "utf8" });
  return res;
}

async function waitForWeb(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(webUrl + "/", { redirect: "manual" });
      if (res.status === 200) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function loginAndUpload() {
  const login = await fetch(webUrl + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "teacher01", password: teacherPassword })
  });
  if (login.status !== 200) return { ok: false, detail: "登录失败 " + login.status };
  const cookie = login.headers.getSetCookie()[0].split(";")[0];

  const title = "compose 冒烟材料 " + new Date().toISOString().slice(11, 19);
  const form = new FormData();
  form.append("title", title);
  form.append("file", new Blob([Buffer.from("# " + title + "\n\n用于验证 down/up 后数据仍在。", "utf8")], { type: "text/markdown" }), "compose-smoke.md");
  const upload = await fetch(webUrl + "/api/materials", { method: "POST", headers: { Cookie: cookie }, body: form });
  return { ok: upload.status === 201, detail: "上传返回 " + upload.status, cookie, title };
}

async function listTitles(cookie) {
  const res = await fetch(webUrl + "/api/materials", { headers: { Cookie: cookie } });
  const json = await res.json();
  return json.items.map((i) => i.title);
}

console.log("CampusClaw · Docker Compose 冒烟验证");
console.log("目标：" + webUrl + "\n");

console.log("1) 校验 compose 文件");
const config = compose(["config", "--quiet"], { quiet: true });
check("docker compose config 通过", config.status === 0, (config.stderr || "").trim().split("\n")[0] || "");

console.log("\n2) 构建并启动");
check("docker compose up -d --build", compose(["up", "-d", "--build"]).status === 0);

console.log("\n3) 等待站点可用");
check("首页可访问（200）", await waitForWeb(), webUrl + "/");

console.log("\n4) 登录并上传一份材料");
const first = await loginAndUpload();
check("teacher01 登录 + 上传成功", first.ok, first.detail);
const titlesBefore = first.ok ? await listTitles(first.cookie) : [];
check("上传的材料出现在列表中", first.ok && titlesBefore.includes(first.title), first.title);

console.log("\n5) down 再 up（验证数据持久化）");
check("docker compose down", compose(["down"]).status === 0);
check("docker compose up -d", compose(["up", "-d"]).status === 0);
check("重启后站点恢复", await waitForWeb());

console.log("\n6) 重启后数据仍在");
const second = await loginAndUpload();
const titlesAfter = second.ok ? await listTitles(second.cookie) : [];
check("down/up 后原材料仍存在", first.ok && titlesAfter.includes(first.title), first.title);

const failed = results.filter((r) => !r.ok);
console.log("\n" + "=".repeat(60));
console.log("结果：" + (results.length - failed.length) + "/" + results.length + " 项通过");
if (failed.length) {
  console.log("失败项：" + failed.map((f) => f.name).join("、"));
  process.exitCode = 1;
}
