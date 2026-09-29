import { useState } from "react";
import type { RouteProps } from "../App";
import { ApiError, askQuestion, CurrentUser, fetchCurrentUser, logout, searchMaterials, SearchMode, SearchResponse, AskResponse } from "../lib/api";
import { applyTheme, readStoredTheme, Theme } from "../lib/theme";

const MODES: Array<{ value: SearchMode; label: string; hint: string }> = [
  { value: "keyword", label: "关键字", hint: "只查 2-gram 倒排，不调用嵌入模型" },
  { value: "vector", label: "向量", hint: "问句嵌入后按余弦相似度检索，低于阈值丢弃" },
  { value: "hybrid", label: "混合", hint: "两路各排后按 RRF(k=60) 融合" }
];

function scoreText(hit: SearchResponse["hits"][number]): string {
  if (hit.matched_by.includes("keyword") && hit.keyword_score !== null) {
    return "关键字 " + hit.keyword_score.toFixed(4);
  }
  if (hit.vector_score !== null) return "余弦 " + hit.vector_score.toFixed(4);
  return hit.score !== null ? hit.score.toFixed(4) : "-";
}

export default function SearchPage({ navigate }: RouteProps) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [ask, setAsk] = useState<AskResponse | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  useState(() => {
    fetchCurrentUser()
      .then((me) => {
        if (!me) navigate("/");
        else setUser(me);
      })
      .catch(() => navigate("/"));
    return undefined;
  });

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  async function onSearch() {
    if (!query.trim()) {
      setError("请输入检索内容");
      return;
    }
    setSearching(true);
    setError(null);
    try {
      setResult(await searchMaterials(query.trim(), mode));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        navigate("/");
        return;
      }
      setError(err instanceof Error ? err.message : "检索失败");
    } finally {
      setSearching(false);
    }
  }

  async function onAsk() {
    if (!question.trim()) {
      setAskError("请输入问题");
      return;
    }
    setAsking(true);
    setAskError(null);
    try {
      setAsk(await askQuestion(question.trim()));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        navigate("/");
        return;
      }
      setAskError(err instanceof Error ? err.message : "提问失败");
    } finally {
      setAsking(false);
    }
  }

  async function onLogout() {
    try {
      await logout();
    } finally {
      navigate("/");
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand brand-inline">
          <span className="brand-mark">CC</span>
          <span className="brand-text">
            <strong>CampusClaw</strong>
            <small>迭代 2 · 可追溯知识库检索</small>
          </span>
        </div>
        <div className="header-right">
          {user ? (
            <span className="user-chip">
              <strong>{user.displayName}</strong>
              <span className="user-meta">
                {user.role === "teacher" ? "教师" : "学生"} · {user.className}
              </span>
            </span>
          ) : null}
          <button className="ghost-btn ghost-btn-lg" type="button" onClick={() => navigate("/materials")}>
            材料页
          </button>
          <button className="theme-toggle" type="button" onClick={toggleTheme}>
            {theme === "dark" ? "浅色模式" : "深色模式"}
          </button>
          <button className="ghost-btn ghost-btn-lg" type="button" onClick={onLogout}>
            退出登录
          </button>
        </div>
      </header>

      <main className="app-main">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>本班知识库检索</h2>
              <p className="panel-sub">
                检索范围仅限本班材料：班级取自服务端会话，请求参数里的班级编号一律无效。
              </p>
            </div>
          </div>

          <div className="search-bar">
            <input
              type="search"
              placeholder="例如：三角函数的定义域与单调性"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onSearch();
              }}
            />
            <button className="primary-btn search-btn" type="button" onClick={onSearch} disabled={searching}>
              {searching ? "检索中…" : "检索"}
            </button>
          </div>

          <div className="mode-switch">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                className={mode === m.value ? "mode-item mode-item-active" : "mode-item"}
                onClick={() => setMode(m.value)}
                title={m.hint}
              >
                <strong>{m.label}</strong>
                <span>{m.hint}</span>
              </button>
            ))}
          </div>

          {error ? (
            <div className="alert" role="alert">
              <strong>检索失败</strong>
              <span>{error}</span>
            </div>
          ) : null}

          {result ? (
            <>
              <div className="result-meta">
                <span>模式：{result.mode}</span>
                <span>关键字命中 {result.counts.keyword} 条</span>
                <span>向量命中 {result.counts.vector} 条</span>
                <span>合并后 {result.counts.total} 条</span>
                <span>
                  嵌入：{result.embedding.provider}/{result.embedding.model}
                  {result.embedding.called ? "（本次已调用）" : "（关键字模式未调用）"}
                </span>
              </div>

              {result.hits.length === 0 ? (
                <p className="empty">资料中未找到相关内容</p>
              ) : (
                <ul className="hit-list">
                  {result.hits.map((hit) => (
                    <li key={hit.chunk_id}>
                      <div className="hit-head">
                        <span className="hit-title">{hit.material_title}</span>
                        <span className="hit-badge">第 {hit.chunk_index + 1} 段</span>
                        <span className="hit-badge">
                          字符 [{hit.char_start}, {hit.char_end})
                        </span>
                        {hit.matched_by.map((m) => (
                          <span key={m} className="hit-badge hit-badge-source">
                            {m === "keyword" ? "关键字" : "向量"}
                          </span>
                        ))}
                        <span className="hit-score">{scoreText(hit)}</span>
                      </div>
                      <p className="hit-snippet">{hit.snippet}…</p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>向本班材料提问</h2>
              <p className="panel-sub">
                先混合检索取前 4 条切片，有依据才调用对话模型；无依据直接返回固定文案且不调用模型。
              </p>
            </div>
          </div>

          <div className="search-bar">
            <input
              type="search"
              placeholder="例如：三角函数的定义域怎么求？"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onAsk();
              }}
            />
            <button className="primary-btn search-btn" type="button" onClick={onAsk} disabled={asking}>
              {asking ? "生成中…" : "提问"}
            </button>
          </div>

          {askError ? (
            <div className="alert" role="alert">
              <strong>提问失败</strong>
              <span>{askError}</span>
            </div>
          ) : null}

          {ask ? (
            <div className="ask-result">
              <div className="ask-answer">
                <strong>回答</strong>
                <p>{ask.answer}</p>
                <span className="ask-meta">
                  检索到 {ask.retrieved} 条切片 · {ask.model_called ? "已调用对话模型（" + (ask.model ?? "") + "）" : "未调用对话模型"}
                </span>
              </div>
              {ask.citations.length > 0 ? (
                <ol className="citation-list">
                  {ask.citations.map((c) => (
                    <li key={c.chunk_id}>
                      <span className="citation-index">[{c.index}]</span>
                      <span className="citation-title">{c.material_title}</span>
                      <span className="hit-badge">第 {c.chunk_index + 1} 段</span>
                      <span className="hit-badge">
                        字符 [{c.char_start}, {c.char_end})
                      </span>
                      <p className="hit-snippet">{c.snippet}…</p>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
