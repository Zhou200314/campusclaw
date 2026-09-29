// 知识库本迭代只负责“存正文”：上传后提取可查询的正文写入 knowledge_entries。
// 检索 / 问答 / 向量化不在本迭代范围。

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".log", ".yml", ".yaml", ".html", ".htm", ".tex", ".srt", ".vtt"
]);

const MAX_BODY_CHARS = 200000;

function extensionOf(filename) {
  const idx = String(filename ?? "").lastIndexOf(".");
  return idx === -1 ? "" : String(filename).slice(idx).toLowerCase();
}

function looksLikeText(buffer) {
  if (buffer.length === 0) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    // 允许 UTF-8 多字节、换行、制表符与常见可打印字符
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length < 0.05;
}

function decodeUtf8(buffer) {
  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

export function extractText(buffer, filename) {
  const ext = extensionOf(filename);
  if (TEXT_EXTENSIONS.has(ext) || looksLikeText(buffer)) {
    const text = decodeUtf8(buffer).replace(/\r\n/g, "\n").trim();
    const truncated = text.length > MAX_BODY_CHARS;
    return {
      body: truncated ? text.slice(0, MAX_BODY_CHARS) : text,
      extracted: true,
      truncated,
      note: truncated ? "正文超长，已截断存储前 " + MAX_BODY_CHARS + " 个字符" : null
    };
  }
  return {
    body: "（二进制文件，未提取正文；知识库仅登记来源信息）来源文件：" + String(filename ?? ""),
    extracted: false,
    truncated: false,
    note: "该格式暂不支持正文提取，仅登记来源信息"
  };
}
