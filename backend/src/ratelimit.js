// 登录失败限流：以「用户名 + IP」为维度计数，锁定期内即使口令正确也拒绝。
// 锁定响应与凭据错误响应完全同形，避免 429 / 文案差异变成账号枚举的依据。
const WINDOW_MS = 15 * 60 * 1000;

export function isLocked(db, username, ip, now = new Date()) {
  const row = db
    .prepare("SELECT locked_until FROM login_attempts WHERE username = ? AND ip = ?")
    .get(username, ip);
  if (!row || !row.locked_until) return false;
  return new Date(row.locked_until).getTime() > now.getTime();
}

export function registerFailure(db, username, ip, config, now = new Date()) {
  const row = db
    .prepare("SELECT fail_count, first_fail_at, locked_until FROM login_attempts WHERE username = ? AND ip = ?")
    .get(username, ip);

  let failCount = 1;
  let firstFailAt = now.toISOString();

  if (row) {
    const stale = now.getTime() - new Date(row.first_fail_at).getTime() > WINDOW_MS;
    firstFailAt = stale ? now.toISOString() : row.first_fail_at;
    failCount = stale ? 1 : Number(row.fail_count) + 1;
  }

  const shouldLock = failCount >= config.loginFailThreshold;
  const lockedUntil = shouldLock
    ? new Date(now.getTime() + config.loginLockSeconds * 1000).toISOString()
    : null;

  if (shouldLock) {
    failCount = 0;
    firstFailAt = now.toISOString();
  }

  db.prepare(
    "INSERT INTO login_attempts (username, ip, fail_count, first_fail_at, locked_until) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(username, ip) DO UPDATE SET fail_count = excluded.fail_count, first_fail_at = excluded.first_fail_at, locked_until = excluded.locked_until"
  ).run(username, ip, failCount, firstFailAt, lockedUntil);
}

export function clearFailures(db, username, ip) {
  db.prepare("DELETE FROM login_attempts WHERE username = ? AND ip = ?").run(username, ip);
}
