// 切分模块：把一个知识条目的正文切成若干切片（检索的最小单位）。
// 三种策略：
//   auto      默认，最大 800 字、重叠 80 字，优先在空行 / 换行 / 句号处断开
//   custom    自定义分隔符与长度：最大 100–2000 字，重叠 0–50%，可选预处理
//   hierarchy 按 Markdown 标题（#/##/###）分章，标题保留在切片内，过长再按窗口切分
// 切分只处理正文，不改写原文；偏移量相对"预处理后的文本"计算。

export const DEFAULT_AUTO = { maxChars: 800, overlapChars: 80 };
export const CUSTOM_LIMITS = { minChars: 100, maxChars: 2000, minOverlapPercent: 0, maxOverlapPercent: 50 };

const SEPARATORS = ["\n\n", "\n", "。", "；", "，"];

export function preprocessText(text, options = {}) {
  let out = String(text ?? "");
  if (options.stripLinks) {
    out = out.replace(/https?:\/\/\S+/gi, "").replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "");
  }
  if (options.collapseWhitespace) {
    out = out.replace(/[ \t\u3000]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  }
  return out;
}

// 在 [start, end) 内找最靠后的断点；找不到返回 -1
function lastBreak(text, start, end) {
  const minBreak = start + Math.floor((end - start) * 0.5);
  for (const sep of SEPARATORS) {
    const idx = text.lastIndexOf(sep, end - 1);
    if (idx >= minBreak) return idx + sep.length;
  }
  return -1;
}

function windowChunks(text, { maxChars, overlapChars }) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const cut = lastBreak(text, start, end);
      if (cut > start) end = cut;
    }
    chunks.push({ text: text.slice(start, end), start, end });
    if (end >= text.length) break;
    const next = end - overlapChars;
    start = next > start ? next : start + 1;   // 保证一定前进，避免死循环
  }
  return chunks;
}

// 自定义分隔符：先按分隔符切段，再把段拼到不超过 maxChars 的窗口里
function separatorChunks(text, { maxChars, overlapChars, separator }) {
  const sep = separator && separator.length ? separator : "\n\n";
  if (!text.includes(sep)) return windowChunks(text, { maxChars, overlapChars });

  const parts = [];
  let cursor = 0;
  while (cursor <= text.length) {
    const idx = text.indexOf(sep, cursor);
    if (idx === -1) {
      if (cursor < text.length) parts.push({ text: text.slice(cursor), start: cursor, end: text.length });
      break;
    }
    parts.push({ text: text.slice(cursor, idx + sep.length), start: cursor, end: idx + sep.length });
    cursor = idx + sep.length;
  }

  const chunks = [];
  let current = null;
  for (const part of parts) {
    if (part.end - part.start > maxChars) {
      if (current) {
        chunks.push(current);
        current = null;
      }
      for (const piece of windowChunks(text.slice(part.start, part.end), { maxChars, overlapChars })) {
        chunks.push({ text: piece.text, start: part.start + piece.start, end: part.start + piece.end });
      }
      continue;
    }
    if (!current) {
      current = { text: part.text, start: part.start, end: part.end };
    } else if (part.end - current.start <= maxChars) {
      current = { text: text.slice(current.start, part.end), start: current.start, end: part.end };
    } else {
      chunks.push(current);
      const back = Math.min(overlapChars, current.text.length);
      const overlapStart = Math.max(current.start, current.end - back);
      current = { text: text.slice(overlapStart, part.end), start: overlapStart, end: part.end };
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// 按 Markdown 标题分章；章节超过 maxChars 时退化为窗口切分
function hierarchyChunks(text, { maxChars, overlapChars }) {
  const headingRe = /^(#{1,3})\s+.*$/gm;
  const marks = [];
  let m;
  while ((m = headingRe.exec(text)) !== null) marks.push(m.index);
  if (marks.length === 0) return windowChunks(text, { maxChars, overlapChars });

  const sections = [];
  if (marks[0] > 0) sections.push({ start: 0, end: marks[0] });
  for (let i = 0; i < marks.length; i += 1) {
    sections.push({ start: marks[i], end: i + 1 < marks.length ? marks[i + 1] : text.length });
  }

  const chunks = [];
  for (const section of sections) {
    const slice = text.slice(section.start, section.end);
    if (slice.trim().length === 0) continue;
    if (slice.length <= maxChars) {
      chunks.push({ text: slice, start: section.start, end: section.end });
    } else {
      for (const piece of windowChunks(slice, { maxChars, overlapChars })) {
        chunks.push({ text: piece.text, start: section.start + piece.start, end: section.start + piece.end });
      }
    }
  }
  return chunks;
}

export function normalizeOptions(options = {}) {
  const strategy = ["auto", "custom", "hierarchy"].includes(options.strategy) ? options.strategy : "auto";

  if (strategy === "auto") return { strategy, maxChars: DEFAULT_AUTO.maxChars, overlapChars: DEFAULT_AUTO.overlapChars, separator: null };

  if (strategy === "hierarchy") {
    return { strategy, maxChars: DEFAULT_AUTO.maxChars, overlapChars: DEFAULT_AUTO.overlapChars, separator: null };
  }

  // custom：长度与重叠都夹到规约允许的区间
  const maxChars = Math.min(Math.max(Number(options.maxChars) || 800, CUSTOM_LIMITS.minChars), CUSTOM_LIMITS.maxChars);
  const percent = Math.min(Math.max(Number(options.overlapPercent) || 0, CUSTOM_LIMITS.minOverlapPercent), CUSTOM_LIMITS.maxOverlapPercent);
  return {
    strategy,
    maxChars,
    overlapChars: Math.floor((maxChars * percent) / 100),
    separator: options.separator || "\n\n"
  };
}

export function chunkText(text, options = {}) {
  const normalized = normalizeOptions(options);
  const processed = preprocessText(text, {
    stripLinks: options.stripLinks === true,
    collapseWhitespace: options.collapseWhitespace === true
  });

  let pieces;
  if (normalized.strategy === "hierarchy") {
    pieces = hierarchyChunks(processed, normalized);
  } else if (normalized.strategy === "custom") {
    pieces = separatorChunks(processed, normalized);
  } else {
    pieces = windowChunks(processed, normalized);
  }

  return {
    strategy: normalized.strategy,
    maxChars: normalized.maxChars,
    overlapChars: normalized.overlapChars,
    separator: normalized.separator,
    processedLength: processed.length,
    chunks: pieces
      .filter((c) => c.text.trim().length > 0)
      .map((c, index) => ({ index, text: c.text, start: c.start, end: c.end }))
  };
}
