// 一键生成作业截图：登录页（浅色/深色）、登录失败提示、教师材料页、学生材料页。
// 用法（在项目根目录执行）：
//   1) npm install            # 安装依赖（含 playwright-core）
//   2) npm run screenshots
// 脚本会自己拉起后端服务，用本机已安装的 Chrome/Edge 渲染，结束后自动关闭服务。
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const outDir = path.join(projectRoot, "docs", "evidence");
const baseUrl = process.env.CAMPUSCLAW_BASE_URL ?? "http://127.0.0.1:8080";
const teacherPassword = process.env.SEED_TEACHER_PASSWORD ?? "Teacher@123";
const studentPassword = process.env.SEED_STUDENT_PASSWORD ?? "Student@123";

let playwright;
try {
  playwright = await import("playwright-core");
} catch {
  console.error("缺少 playwright-core。请先执行：npm install");
  process.exit(1);
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"
].filter(Boolean);

async function fileExists(target) {
  try {
    await (await import("node:fs/promises")).access(target);
    return true;
  } catch {
    return false;
  }
}

async function resolveBrowser() {
  for (const candidate of CHROME_CANDIDATES) {
    if (await fileExists(candidate)) return { executablePath: candidate };
  }
  // 交给 playwright-core 自己查找 Chrome 渠道
  return { channel: "chrome" };
}

async function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url + "/api/me");
      if (res.status === 401 || res.ok) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function main() {
  await mkdir(outDir, { recursive: true });

  let server = null;
  let startedServer = false;
  try {
    const probe = await fetch(baseUrl + "/api/me").catch(() => null);
    if (!probe) {
      console.log("[1/3] 启动后端服务…");
      server = spawn(process.execPath, [path.join(projectRoot, "backend", "src", "server.js")], {
        cwd: projectRoot,
        stdio: "inherit"
      });
      startedServer = true;
      const ready = await waitForServer(baseUrl);
      if (!ready) throw new Error("后端服务启动超时");
    } else {
      console.log("[1/3] 检测到服务已在运行，直接复用。");
    }

    console.log("[2/3] 启动浏览器…");
    const browser = await playwright.chromium.launch({
      ...(await resolveBrowser()),
      args: ["--headless=new"]
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();

    const shot = async (name) => {
      const file = path.join(outDir, name);
      await page.screenshot({ path: file });
      console.log("  ✔ " + name);
    };

    console.log("[3/3] 采集截图…");
    await page.goto(baseUrl + "/", { waitUntil: "networkidle" });
    await page.waitForSelector(".primary-btn");
    await shot("01-login-light.png");

    await page.goto(baseUrl + "/?theme=dark", { waitUntil: "networkidle" });
    await page.waitForSelector(".primary-btn");
    await shot("02-login-dark.png");

    // 登录失败：统一失败提示
    await page.goto(baseUrl + "/", { waitUntil: "networkidle" });
    await page.fill("#username", "teacher01");
    await page.fill("#password", "wrong-password");
    await page.click(".primary-btn");
    await page.waitForSelector(".alert");
    await shot("03-login-failed.png");

    // 教师登录成功 -> 材料页
    await page.fill("#password", teacherPassword);
    await page.click(".primary-btn");
    await page.waitForSelector(".material-list");
    await shot("04-materials-teacher.png");

    // 教师上传 -> 上传成功提示
    await page.setInputFiles("#upload-file", {
      name: "1班-上传演示.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# 1班-上传演示\n\n用于截图的上传演示正文，班级标识 CLASS-1。\n", "utf8")
    });
    await page.fill("#upload-title", "1班-上传演示材料");
    await page.click(".upload-btn");
    await page.waitForSelector(".success");
    await shot("06-upload-success.png");

    // 学生登录成功 -> 材料页
    await context.clearCookies();
    await page.goto(baseUrl + "/", { waitUntil: "networkidle" });
    await page.fill("#username", "student01");
    await page.fill("#password", studentPassword);
    await page.click(".primary-btn");
    await page.waitForSelector(".material-list");
    await shot("05-materials-student.png");

    await browser.close();
    console.log("截图已输出到：" + outDir);
  } finally {
    if (startedServer && server) server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
