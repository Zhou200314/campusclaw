import { useCallback, useEffect, useState } from "react";
import type { RouteProps } from "../App";
import {
  ApiError,
  CurrentUser,
  downloadUrl,
  fetchCurrentUser,
  fetchMaterials,
  formatSize,
  logout,
  MaterialSummary,
  uploadMaterial,
  UploadResult
} from "../lib/api";
import { applyTheme, readStoredTheme, Theme } from "../lib/theme";

export default function MaterialsPage({ navigate }: RouteProps) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [items, setItems] = useState<MaterialSummary[]>([]);
  const [keyword, setKeyword] = useState("");
  const [className, setClassName] = useState("");
  const [canUpload, setCanUpload] = useState(false);
  const [crossClassVisible, setCrossClassVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  const load = useCallback(
    async (search: string) => {
      setLoading(true);
      setError(null);
      try {
        const me = await fetchCurrentUser();
        if (!me) {
          navigate("/");
          return;
        }
        setUser(me);
        const data = await fetchMaterials(search);
        setItems(data.items);
        setClassName(data.className ?? me.className ?? "");
        setCanUpload(data.canUpload);
        setCrossClassVisible(data.crossClassVisible);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          navigate("/");
          return;
        }
        setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        setLoading(false);
      }
    },
    [navigate]
  );

  useEffect(() => {
    void load("");
  }, [load]);

  async function onLogout() {
    try {
      await logout();
    } finally {
      navigate("/");
    }
  }

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  async function onUpload() {
    setUploadError(null);
    setUploadResult(null);
    if (!file) {
      setUploadError("请选择要上传的文件");
      return;
    }
    setUploading(true);
    try {
      const result = await uploadMaterial(file, title);
      setUploadResult(result);
      setFile(null);
      setTitle("");
      const input = document.getElementById("upload-file") as HTMLInputElement | null;
      if (input) input.value = "";
      await load(keyword);
    } catch (err) {
      if (err instanceof ApiError) {
        setUploadError(err.message);
      } else {
        setUploadError("上传失败，请稍后重试");
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand brand-inline">
          <span className="brand-mark">CC</span>
          <span className="brand-text">
            <strong>CampusClaw</strong>
            <small>迭代 1 · 教研材料与知识库底座</small>
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
          <button className="ghost-btn ghost-btn-lg" type="button" onClick={() => navigate("/search")}>
            知识库检索
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
        {canUpload ? (
          <section className="panel panel-upload">
            <div className="panel-head">
              <div>
                <h2>上传教研材料</h2>
                <p className="panel-sub">
                  上传后同一事务写入材料表与知识库表：任一步失败两张表都不写入。
                </p>
              </div>
            </div>

            <div className="upload-grid">
              <div className="field">
                <label htmlFor="upload-title">材料标题（留空则用文件名）</label>
                <input
                  id="upload-title"
                  type="text"
                  placeholder="例如：1班-三角函数复习提纲"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="upload-file">选择文件（教师可用，学生上传返回 403）</label>
                <input
                  id="upload-file"
                  type="file"
                  onChange={(event) => setFile(event.target.files && event.target.files[0] ? event.target.files[0] : null)}
                />
              </div>

              <button className="primary-btn upload-btn" type="button" onClick={onUpload} disabled={uploading}>
                {uploading ? "正在上传…" : "上传并入库"}
              </button>
            </div>

            {uploadError ? (
              <div className="alert" role="alert">
                <strong>上传失败</strong>
                <span>{uploadError}</span>
              </div>
            ) : null}

            {uploadResult ? (
              <div className="success" role="status">
                <strong>上传成功</strong>
                <span>
                  材料 #{uploadResult.material.id}（{formatSize(uploadResult.material.sizeBytes)}）与知识库条目 #
                  {uploadResult.knowledgeEntry.id} 已在同一事务写入。
                  {uploadResult.knowledgeEntry.extracted
                    ? "正文已提取，可用于本班列表搜索。"
                    : uploadResult.knowledgeEntry.note ?? "该格式未提取正文。"}
                </span>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>{crossClassVisible ? "全部班级材料" : (className || "本班") + "材料"}</h2>
              <p className="panel-sub">
                {crossClassVisible
                  ? "跨班可见已开启：可以看到其他班级的材料标题，但正文与下载会被拒绝（403）。"
                  : "班级来自服务端会话，请求参数无法切换班级；跨班按 ID 访问与下载均返回 404。"}
              </p>
            </div>
            <div className="search">
              <input
                type="search"
                placeholder="搜索本班材料标题或正文"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void load(keyword);
                }}
              />
              <button className="ghost-btn" type="button" onClick={() => void load(keyword)}>
                搜索
              </button>
            </div>
          </div>

          {error ? (
            <div className="alert" role="alert">
              <strong>请求失败</strong>
              <span>{error}</span>
            </div>
          ) : null}

          {loading ? (
            <p className="empty">加载中…</p>
          ) : items.length === 0 ? (
            <p className="empty">本班暂无材料</p>
          ) : (
            <ul className="material-list">
              {items.map((item) => (
                <li key={item.id}>
                  <div className="material-main">
                    <span className="material-title">
                      {item.title}
                      {item.sameClass ? null : (
                        <span className="class-badge">{item.className ?? "其他班级"}</span>
                      )}
                    </span>
                    <span className="material-file">
                      {item.filename ?? "无附件"}
                      {item.sizeBytes ? " · " + formatSize(item.sizeBytes) : ""}
                    </span>
                  </div>
                  <div className="material-actions">
                    {item.canDownload ? (
                      <a className="ghost-btn ghost-btn-inline" href={downloadUrl(item.id)}>
                        下载
                      </a>
                    ) : (
                      <span className="no-download" title="跨班材料只能查看标题，不能下载">
                        不可下载
                      </span>
                    )}
                    <span className="material-id">#{item.id}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {user?.role === "teacher" ? (
            <p className="panel-note">
              教师可上传、查看、下载本班材料；上传接口会先校验角色与班级，再在同事务内写入材料与知识库两表。
            </p>
          ) : (
            <p className="panel-note">学生只有查看与下载权限，调用上传接口返回 403。</p>
          )}
        </section>
      </main>
    </div>
  );
}
