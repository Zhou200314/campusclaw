import express from "express";
import process from "node:process";
import { COOKIE_NAME } from "./config.js";
import { parseCookies, serializeCookie } from "./cookies.js";
import { hashSessionToken, newSessionToken, verifyPassword, verifyPasswordDummy } from "./security.js";
import { clearFailures, isLocked, registerFailure } from "./ratelimit.js";
import { nowIso } from "./db.js";

// 统一失败响应：用户不存在、口令错误、锁定期内三种情况返回完全一致的 401 响应体，
// 避免通过文案、状态码或响应结构枚举账号。
export const INVALID_CREDENTIALS_BODY = Object.freeze({
  error: {
    code: "INVALID_CREDENTIALS",
    message: "用户名或密码错误"
  }
});

export const UNAUTHENTICATED_BODY = Object.freeze({
  error: {
    code: "UNAUTHENTICATED",
    message: "未登录或会话已失效"
  }
});

export function clientIp(req) {
  // 未开启 trust proxy 时 req.ip 就是 socket 地址；开启后由 Express 从 X-Forwarded-For 解析
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

function cookieSecure() {
  return process.env.COOKIE_SECURE === "1";
}

function toPublicUser(db, row) {
  const klass = db.prepare("SELECT name FROM classes WHERE id = ?").get(row.class_id);
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    classId: row.class_id,
    className: klass ? klass.name : null
  };
}

export function findSessionUser(db, token, now = new Date()) {
  if (!token) return null;
  const row = db
    .prepare(
      "SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?"
    )
    .get(hashSessionToken(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(hashSessionToken(token));
    return null;
  }
  return row;
}

function issueSession(db, config, res, userId) {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlSeconds * 1000).toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    hashSessionToken(token),
    userId,
    nowIso(),
    expiresAt
  );
  res.append(
    "Set-Cookie",
    serializeCookie(COOKIE_NAME, token, {
      maxAge: config.sessionTtlSeconds,
      httpOnly: true,
      sameSite: "Lax",
      secure: cookieSecure()
    })
  );
  return token;
}

function clearCookie(res) {
  res.append(
    "Set-Cookie",
    serializeCookie(COOKIE_NAME, "", { maxAge: 0, httpOnly: true, sameSite: "Lax", secure: cookieSecure() })
  );
}

// 会话中间件：角色与班级每次都从用户表读取，不采信客户端回传的任何声明。
export function sessionMiddleware(db) {
  return (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    const row = findSessionUser(db, token);
    req.sessionToken = token ?? null;
    req.user = row ? toPublicUser(db, row) : null;
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json(UNAUTHENTICATED_BODY);
  }
  return next();
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json(UNAUTHENTICATED_BODY);
    if (req.user.role !== role) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "当前角色无权执行该操作" } });
    }
    return next();
  };
}

export function createAuthRouter({ db, config }) {
  const router = express.Router();

  router.post("/api/login", (req, res) => {
    const rawUsername = typeof req.body?.username === "string" ? req.body.username : "";
    const rawPassword = typeof req.body?.password === "string" ? req.body.password : "";
    const username = rawUsername.trim().toLowerCase();
    const password = rawPassword;
    const ip = clientIp(req);
    const now = new Date();

    if (!username || !password) {
      verifyPasswordDummy(password);
      return res.status(401).json(INVALID_CREDENTIALS_BODY);
    }

    if (isLocked(db, username, ip, now)) {
      verifyPasswordDummy(password);
      return res.status(401).json(INVALID_CREDENTIALS_BODY);
    }

    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (!user) {
      // 用户不存在也做一次等价耗时的散列比较，再返回同形响应。
      verifyPasswordDummy(password);
      registerFailure(db, username, ip, config, now);
      return res.status(401).json(INVALID_CREDENTIALS_BODY);
    }

    if (!verifyPassword(password, user.password_hash)) {
      registerFailure(db, username, ip, config, now);
      return res.status(401).json(INVALID_CREDENTIALS_BODY);
    }

    clearFailures(db, username, ip);

    // 防会话固定：登录成功前先作废旧会话，再换发新的会话 ID。
    if (req.sessionToken) {
      db.prepare("DELETE FROM sessions WHERE id = ?").run(hashSessionToken(req.sessionToken));
    }
    issueSession(db, config, res, user.id);

    return res.status(200).json({ user: toPublicUser(db, user) });
  });

  router.post("/api/logout", (req, res) => {
    if (req.sessionToken) {
      db.prepare("DELETE FROM sessions WHERE id = ?").run(hashSessionToken(req.sessionToken));
    }
    clearCookie(res);
    return res.status(204).end();
  });

  router.get("/api/me", requireAuth, (req, res) => {
    return res.status(200).json({ user: req.user });
  });

  return router;
}
