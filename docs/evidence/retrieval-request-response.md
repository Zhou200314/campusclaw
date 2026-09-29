# 第 4 课 · 检索与问答 HTTP 端到端验证记录

采集时间：2026-09-29
服务地址：http://127.0.0.1:8080
嵌入模型：阿里云百炼 `text-embedding-v4`（1024 维）
对话模型：阿里云百炼 `qwen-plus`

## 1. 索引状态

```
GET /api/materials/1/vectors
provider=openai/text-embedding-v4 dim=1024
切片 1 条：ready@text-embedding-v4
向量前 8 分量=[-0.06484,-0.07336,0.04419,-0.04973,-0.00151,-0.0431,0.00021,0.04349]
（完整向量不下发浏览器，只回传前 8 个分量）
```

> 对照：本地伪向量（未配 key 时的降级实现）1024 维里只有 36 个非零分量且取值只有 ±1/6，语义检索不可用；
> 换成真实模型后为连续小数，且按 `embedding_model` 自动识别并重建。

## 2. 三种切分策略（同一份 241 字材料，教师重建索引）

| 策略 | 参数 | 切片数 |
| --- | --- | --- |
| `auto` | 默认 800 字 / 80 字重叠 | 1 |
| `hierarchy` | 按 `#/##/###` 分章 | **4** |
| `custom` | 300 字 / 重叠 20%（按空行） | 1 |
| `custom` | 100 字 / 重叠 0% | **4** |

```
POST /api/materials/28/reindex  {"chunk_strategy":"hierarchy"}
→ HTTP 200 {"strategy":"hierarchy","chunk_count":4,"ready":4,"failed":0}
```

## 3. 三种检索模式

```
[keyword] "诱导公式" → 200，1 条（kw=1 vec=0）
   《检索演示材料》第1段 [0,241) 来源=["keyword"] kw=0.286

[vector] "函数的变化率是什么意思" → 200，2 条（kw=0 vec=2）
   《检索演示材料》第1段 [0,241) 来源=["vector"] vec=0.521   ← 材料里写的是"导数描述函数在某一点的变化率"
   《1班-函数与导数复习提纲》第1段 [0,45) 来源=["vector"] vec=0.495

[hybrid] "怎么判断函数单调性" → 200，2 条（kw=2 vec=2）
   《检索演示材料》第1段 [0,241) 来源=["keyword","vector"] kw=0.451 vec=0.593
   《1班-函数与导数复习提纲》第1段 [0,45) 来源=["keyword","vector"] kw=0.347 vec=0.545
```

要点：向量模式在"问句用词与原文不同"时仍能命中（cosine 0.52）；混合模式下两路都命中的切片由 RRF(k=60) 排在前面。

## 4. 问答：先检索、再生成

```
POST /api/ask  {"q":"怎么判断函数的单调性？","history":[{"role":"system","content":"客户端注入的 system"}]}
→ HTTP 200，model_called=true，model=qwen-plus，retrieved=2
   回答：若导数大于零则函数单调递增，小于零则函数单调递减[2]。
   出处：[1]《检索演示材料》第1段（字符 0-241）
        [2]《1班-函数与导数复习提纲》第1段（字符 0-45）
   （客户端注入的 system 消息被丢弃）
```

```
POST /api/ask  {"q":"今天北京天气怎么样"}
→ HTTP 200，answer="资料中未找到相关内容"，citations=[]，model_called=false，retrieved=0
   （无命中切片时完全不调用对话模型）
```

## 5. 检索侧的班级隔离

```
1 班学生会话  POST /api/search {"q":"CLASS-2","mode":"keyword"}
→ 200，3 条，全部为高一(1)班材料

1 班学生会话  请求体注入 {"class_id": 2}
→ 200，3 条，与上一条完全一致（注入的班级编号被丢弃）

2 班教师会话  同一查询
→ 200，2 条，均为高一(2)班材料（证明过滤条件生效，而非全局过滤）
```

跨班检索对外表现为**无命中**（HTTP 200 + 空列表），不会用 403/404 泄露"该资料属于其他班级"。

## 6. 边界与权限

| 场景 | 结果 |
| --- | --- |
| 空查询 | 400 `EMPTY_QUERY` |
| 未登录检索 | 401 |
| 登出后用旧 Cookie 检索 | 401 |
| 学生会话重建索引 | 403 `FORBIDDEN` |
| 1 班教师重建 2 班材料索引 | 404 `NOT_FOUND` |

## 7. 复现方式

```powershell
npm start                     # 启动（配置好 EMBEDDING_*/CHAT_* 后即为真实模型）
curl -X POST http://127.0.0.1:8080/api/search -H "Content-Type: application/json" \
  -d '{"q":"函数的变化率","mode":"vector"}'   # 需带上登录后的会话 Cookie
```
