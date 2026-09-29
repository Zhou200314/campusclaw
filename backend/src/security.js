import crypto from "node:crypto";

// 口令散列：scrypt + 每用户随机盐，验证用恒定时间比较。
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 32;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
  return ["scrypt", SCRYPT_PARAMS.N, SCRYPT_PARAMS.r, SCRYPT_PARAMS.p, salt.toString("hex"), derived.toString("hex")].join("$");
}

export function verifyPassword(password, stored) {
  const parts = String(stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number.parseInt(parts[1], 10);
  const r = Number.parseInt(parts[2], 10);
  const p = Number.parseInt(parts[3], 10);
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  if (!N || !r || !p || salt.length === 0 || expected.length === 0) return false;
  let derived;
  try {
    derived = crypto.scryptSync(password, salt, expected.length, { N, r, p });
  } catch {
    return false;
  }
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

// 用户不存在时也执行一次等价耗时的散列比较，避免用响应耗时区分账号是否存在。
const DUMMY_HASH = hashPassword("campusclaw-timing-equalization");
export function verifyPasswordDummy(password) {
  verifyPassword(password, DUMMY_HASH);
}

export function newSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

// 服务端只保存会话令牌的散列值，数据库被读取也无法直接重放会话。
export function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}
