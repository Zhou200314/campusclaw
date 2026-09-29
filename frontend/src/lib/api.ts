export type Role = "teacher" | "student";

export interface CurrentUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  classId: number;
  className: string | null;
}

export interface MaterialSummary {
  id: number;
  title: string;
  filename: string | null;
  sizeBytes: number | null;
  createdAt: string;
  classId: number;
  className: string | null;
  sameClass: boolean;
  canDownload: boolean;
}

export interface MaterialList {
  classId: number;
  className: string | null;
  canUpload: boolean;
  crossClassVisible: boolean;
  items: MaterialSummary[];
}

export interface UploadResult {
  material: {
    id: number;
    title: string;
    filename: string;
    sizeBytes: number;
    classId: number;
    uploadedBy: string;
    createdAt: string;
  };
  knowledgeEntry: {
    id: number;
    materialId: number;
    extracted: boolean;
    note: string | null;
  };
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const code = data?.error?.code ?? "UNKNOWN";
    const message = data?.error?.message ?? "请求失败，请稍后重试";
    throw new ApiError(response.status, code, message);
  }
  return data as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init
  });
  return parseResponse<T>(response);
}

export function login(username: string, password: string): Promise<{ user: CurrentUser }> {
  return request<{ user: CurrentUser }>("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
}

export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  try {
    const data = await request<{ user: CurrentUser }>("/api/me");
    return data.user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function logout(): Promise<void> {
  return request<void>("/api/logout", { method: "POST" });
}

export function fetchMaterials(keyword?: string): Promise<MaterialList> {
  const query = keyword && keyword.trim() ? "?q=" + encodeURIComponent(keyword.trim()) : "";
  return request<MaterialList>("/api/materials" + query);
}

// 上传走 multipart/form-data：浏览器自动带 boundary，不能手动设置 Content-Type。
export async function uploadMaterial(file: File, title: string): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  if (title.trim()) form.append("title", title.trim());
  const response = await fetch("/api/materials", {
    method: "POST",
    body: form,
    credentials: "same-origin"
  });
  return parseResponse<UploadResult>(response);
}

export function downloadUrl(materialId: number): string {
  return "/api/materials/" + materialId + "/download";
}

export function formatSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

// ---------------- 第 4 课：检索与问答 ----------------

export type SearchMode = "keyword" | "vector" | "hybrid";

export interface SearchHit {
  chunk_id: number;
  material_id: number;
  material_title: string;
  knowledge_entry_id: number | null;
  chunk_index: number;
  char_start: number;
  char_end: number;
  snippet: string;
  score: number | null;
  keyword_score: number | null;
  vector_score: number | null;
  rank_keyword: number | null;
  rank_vector: number | null;
  matched_by: string[];
  rank: number;
}

export interface SearchResponse {
  query: string;
  mode: SearchMode;
  classId: number;
  counts: { keyword: number; vector: number; total: number };
  hits: SearchHit[];
  message: string | null;
  embedding: { provider: string; model: string; dim: number; called: boolean };
}

export interface Citation {
  index: number;
  chunk_id: number;
  material_id: number;
  material_title: string;
  chunk_index: number;
  char_start: number;
  char_end: number;
  snippet: string;
}

export interface AskResponse {
  answer: string;
  citations: Citation[];
  hits: Array<{ chunk_id: number; material_id: number; material_title: string; chunk_index: number }>;
  retrieved: number;
  model_called: boolean;
  model?: string;
  embedding?: { provider: string; model: string; dim: number };
}

export interface ChunkOptionPayload {
  strategy?: "auto" | "custom" | "hierarchy";
  separator?: string;
  maxChars?: number;
  overlapPercent?: number;
  collapseWhitespace?: boolean;
  stripLinks?: boolean;
}

export function searchMaterials(q: string, mode: SearchMode, limit = 10): Promise<SearchResponse> {
  return request<SearchResponse>("/api/search", {
    method: "POST",
    body: JSON.stringify({ q, mode, limit, offset: 0 })
  });
}

export function askQuestion(q: string, history: Array<{ role: string; content: string }> = []): Promise<AskResponse> {
  return request<AskResponse>("/api/ask", {
    method: "POST",
    body: JSON.stringify({ q, history })
  });
}

export interface ReindexResult {
  material_id: number;
  strategy: string;
  max_chars: number;
  overlap_chars: number;
  processed_length: number;
  chunk_count: number;
  ready: number;
  failed: number;
  embed_error: string | null;
}

export function reindexMaterial(materialId: number, options: ChunkOptionPayload = {}): Promise<ReindexResult> {
  const body: Record<string, unknown> = {};
  if (options.strategy) body.chunk_strategy = options.strategy;
  if (options.separator) body.chunk_separator = options.separator;
  if (options.maxChars !== undefined) body.chunk_max_chars = options.maxChars;
  if (options.overlapPercent !== undefined) body.chunk_overlap_percent = options.overlapPercent;
  if (options.collapseWhitespace !== undefined) body.chunk_collapse_ws = options.collapseWhitespace;
  if (options.stripLinks !== undefined) body.chunk_strip_links = options.stripLinks;
  return request<ReindexResult>("/api/materials/" + materialId + "/reindex", {
    method: "POST",
    body: JSON.stringify(body)
  });
}
