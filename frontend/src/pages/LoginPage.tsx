import { FormEvent, useEffect, useState } from "react";
import type { RouteProps } from "../App";
import { ApiError, fetchCurrentUser, login } from "../lib/api";
import { applyTheme, readStoredTheme, Theme } from "../lib/theme";

interface DemoAccount {
  username: string;
  label: string;
  role: string;
  className: string;
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  { username: "teacher01", label: "王老师", role: "教师", className: "高一(1)班" },
  { username: "student01", label: "李同学", role: "学生", className: "高一(1)班" },
  { username: "teacher02", label: "赵老师", role: "教师", className: "高一(2)班" },
  { username: "student02", label: "陈同学", role: "学生", className: "高一(2)班" }
];

export default function LoginPage({ navigate }: RouteProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());

  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser()
      .then((user) => {
        if (!cancelled && user) navigate("/materials");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError("请输入账号和口令");
      return;
    }

    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate("/materials");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("网络异常，请稍后重试");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <aside className="auth-hero">
        <div className="hero-top">
          <div className="brand">
            <span className="brand-mark">CC</span>
            <span className="brand-text">
              <strong>CampusClaw</strong>
              <small>中小学教研智能体</small>
            </span>
          </div>
          <span className="hero-badge">迭代 1 · 登录与会话</span>
        </div>

        <div className="hero-copy">
          <h1>教研材料与知识库底座</h1>
          <p className="hero-lead">
            账号口令登录，身份、角色与班级由服务端会话识别。界面只是入口，访问控制在接口层强制。
          </p>
          <ul className="hero-points">
            <li>
              <span className="dot" />
              会话 Cookie：HttpOnly + SameSite=Lax，登出后旧 Cookie 立即失效
            </li>
            <li>
              <span className="dot" />
              班级即数据边界：材料按班级隔离，跨班访问一律拒绝
            </li>
            <li>
              <span className="dot" />
              登录失败统一提示，并按「用户名 + IP」限流
            </li>
          </ul>
        </div>

        <div className="hero-foot">
          <span>第 3 课 · 实现教程</span>
          <span>步骤 1–3</span>
        </div>
      </aside>

      <main className="auth-panel">
        <div className="auth-panel-inner">
          <div className="panel-toolbar">
            <span className="env-chip">会话 Cookie 登录 · 不使用 JWT</span>
            <button className="theme-toggle" type="button" onClick={toggleTheme}>
              {theme === "dark" ? "浅色模式" : "深色模式"}
            </button>
          </div>

          <section className="card">
            <header className="card-head">
              <h2>登录 CampusClaw</h2>
              <p>使用教师或学生账号登录，成功后将按服务端会话跳转到本班材料页。</p>
            </header>

            <form onSubmit={onSubmit} noValidate>
              <div className="field">
                <label htmlFor="username">账号</label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  placeholder="例如 teacher01"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="password">口令</label>
                <div className="input-wrap">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="请输入口令"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    className="ghost-btn"
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? "隐藏" : "显示"}
                  </button>
                </div>
              </div>

              {error ? (
                <div className="alert" role="alert">
                  <strong>登录失败</strong>
                  <span>{error}</span>
                </div>
              ) : null}

              <button className="primary-btn" type="submit" disabled={submitting}>
                {submitting ? "正在登录…" : "登录"}
              </button>
            </form>

            <div className="demo-block">
              <p className="demo-title">演示账号（点击填入账号名）</p>
              <div className="demo-list">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.username}
                    className="demo-item"
                    type="button"
                    onClick={() => setUsername(account.username)}
                  >
                    <span className="demo-username">{account.username}</span>
                    <span className="demo-meta">
                      {account.label} · {account.role} · {account.className}
                    </span>
                  </button>
                ))}
              </div>
              <p className="demo-hint">
                口令来自环境变量 <code>SEED_TEACHER_PASSWORD</code> / <code>SEED_STUDENT_PASSWORD</code>，
                示例值见仓库根目录 <code>.env.example</code>。
              </p>
            </div>

            <footer className="card-foot">
              未登录访问 <code>/api/materials</code> 返回 <code>401</code>；登录成功换发新的会话 ID。
            </footer>
          </section>
        </div>
      </main>
    </div>
  );
}
