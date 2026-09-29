export type Theme = "light" | "dark";

const STORAGE_KEY = "campusclaw.theme";

function readQueryTheme(): Theme | null {
  try {
    const value = new URLSearchParams(window.location.search).get("theme");
    if (value === "light" || value === "dark") return value;
  } catch {
    // 忽略
  }
  return null;
}

export function readStoredTheme(): Theme {
  const fromQuery = readQueryTheme();
  if (fromQuery) return fromQuery;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // 忽略隐私模式下的存储异常
  }
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 忽略
  }
}

export function applyStoredTheme() {
  applyTheme(readStoredTheme());
}
