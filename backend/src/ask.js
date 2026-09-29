// 问答模块：先检索、再生成。
//   · 无命中切片时直接返回固定文案，绝不调用对话模型（避免用参数记忆硬答）
//   · 有命中时把「材料标题 + 切片序号 + 切片正文」按 [1][2] 顺序交给模型
//   · 客户端自带的 system 消息一律丢弃，system 提示由服务端写入
//   · provider = local 时用摘录方式拼出回答，仅用于没有对话模型密钥时演示链路
export const NO_HIT_ANSWER = "资料中未找到相关内容";
export const NO_HIT_CITATIONS = [];

export const SYSTEM_PROMPT =
  "你是 CampusClaw 的教研助手。只能依据用户提供的编号资料作答，不得使用你自己的记忆补充事实。" +
  "回答要简短，并在句末用 [1]、[2] 这样的编号标注依据来自哪一段资料。" +
  "若资料不足以回答，就只回复：资料中未找到相关内容。";

export function createChatProvider(config) {
  if (config.chatProvider === "openai") {
    return {
      kind: "openai",
      model: config.chatModel,
      available: () => Boolean(config.chatBaseUrl && config.chatApiKey),
      async complete(messages) {
        if (!config.chatBaseUrl || !config.chatApiKey) {
          throw Object.assign(new Error("对话服务未配置：缺少 CHAT_BASE_URL 或 CHAT_API_KEY"), { code: "CHAT_NOT_CONFIGURED" });
        }
        const url = config.chatBaseUrl.replace(/\/$/, "") + "/chat/completions";
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.chatTimeoutMs);
        let res;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.chatApiKey },
            body: JSON.stringify({ model: config.chatModel, messages, temperature: 0.2, stream: false }),
            signal: controller.signal
          });
        } finally {
          clearTimeout(timer);
        }
        const text = await res.text();
        if (!res.ok) throw Object.assign(new Error("对话服务返回 " + res.status + "：" + text.slice(0, 300)), { code: "CHAT_FAILED" });
        const json = JSON.parse(text);
        const answer = json.choices?.[0]?.message?.content;
        if (typeof answer !== "string" || answer.trim() === "") throw Object.assign(new Error("对话服务未返回内容"), { code: "CHAT_FAILED" });
        return answer.trim();
      }
    };
  }

  return {
    kind: "local",
    model: "local-extractive",
    available: () => true,
    async complete(messages) {
      // 无模型时的降级实现：直接摘录第 1 条资料，保证「有依据才作答」的语义仍成立
      const last = [...messages].reverse().find((m) => m.role === "user");
      const context = last?.content ?? "";
      const first = context.split("\n").find((line) => line.startsWith("[1]")) ?? "";
      const body = first.replace(/^\[1\]\s*/, "").slice(0, 200);
      return body ? "根据本班材料：" + body + " [1]" : NO_HIT_ANSWER;
    }
  };
}

export function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && typeof m.content === "string" && m.content.trim() !== "")
    .filter((m) => m.role === "user" || m.role === "assistant")   // 丢弃客户端注入的 system 消息
    .slice(-6);
}

export function buildContext(hits) {
  return hits
    .map((h, i) => "[" + (i + 1) + "] 《" + h.materialTitle + "》第 " + (h.chunkIndex + 1) + " 段：" + h.chunkText)
    .join("\n\n");
}
