CampusClaw 迭代 1 · 上传入库证据采集
目标服务：http://127.0.0.1:8080/
采集时间：2026-09-23T02:37:44.427Z

[准备] teacher01 登录 200，student01 登录 200
[准备] 上传前计数：materials=4  knowledge_entries=0

==============================================================================
步骤：教师上传材料（POST /api/materials，multipart/form-data）
期望：201，材料表与知识库表在同一事务内各新增一行
------------------------------------------------------------------------------
>>> 请求（body 为 multipart，此处展示结构与文本部分）
POST /api/materials HTTP/1.1
Host: 127.0.0.1:8080
Cookie: cc_session=6a9d3ef5ee785c1890ee6632011bbc3da558e26913a8bd057d428f1ac24a9fb0
Content-Type: multipart/form-data; boundary=----CampusClawBoundary1a0cc204f3b
Content-Length: 446

------CampusClawBoundary1a0cc204f3b
Content-Disposition: form-data; name="title"

1班-上传测试-02:37:44
------CampusClawBoundary1a0cc204f3b
Content-Disposition: form-data; name="file"; filename="upload-test.md"
Content-Type: text/markdown

# 1班-上传测试-02:37:44

这是通过上传接口写入的正文，用于验证知识库入库与列表搜索。班级标识 CLASS-1。
------CampusClawBoundary1a0cc204f3b--
<<< 响应（10.2 ms）
HTTP/1.1 201
Content-Type: application/json; charset=utf-8
Content-Length: 251
ETag: W/"fb-8RN5/SD4trzw6OsT7xJ5iDHb3Zk"
Date: Wed, 23 Sep 2026 02:37:44 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"material":{"id":25,"title":"1班-上传测试-02:37:44","filename":"upload-test.md","sizeBytes":141,"classId":1,"uploadedBy":"王老师","createdAt":"2026-09-23T02:37:44.644Z"},"knowledgeEntry":{"id":21,"materialId":25,"extracted":true,"note":null}}
[断言通过] 两表各 +1：materials 4 -> 5，knowledge_entries 0 -> 1

==============================================================================
步骤：读取刚上传材料的详情（GET /api/materials/25）
------------------------------------------------------------------------------
<<< HTTP/1.1 200  {"id":25,"title":"1班-上传测试-02:37:44","body":"# 1班-上传测试-02:37:44\n\n这是通过上传接口写入的正文，用于验证知识库入库与列表搜索。班级标识 CLASS-1。","filename":"upload-test.md","sizeBytes":141,"createdAt":"2026-09-23T02:37:44.644Z","knowledgeEntryId":21}

步骤：下载材料（GET /api/materials/25/download）
>>> 请求头：Cookie: cc_session=6a9d3ef5ee785c1890ee6632011bbc3da558e26913a8bd057d428f1ac24a9fb0
<<< HTTP/1.1 200  Content-Disposition: attachment; filename="upload-test.md"
[提示] 下载内容长度 141 字节，与上传的 141 字节一致：true

==============================================================================
步骤：学生上传材料（应当被拒绝）
期望：403，且两张表都不新增数据
------------------------------------------------------------------------------
>>> 请求：POST /api/materials（Cookie 为 student01 的会话）
<<< 响应 HTTP/1.1 403  {"error":{"code":"FORBIDDEN","message":"当前角色无权执行该操作"}}
[断言通过] 403 且两表计数不变

==============================================================================
步骤：跨班下载（材料 #3 属于高一(2)班，当前会话为高一(1)班）
------------------------------------------------------------------------------
<<< HTTP/1.1 404  {"error":{"code":"NOT_FOUND","message":"材料不存在"}}
[断言通过] 跨班下载与不存在同形返回 404

==============================================================================
步骤：上传超过大小上限的文件（11 MB > 10 MB）
期望：413，且两张表都不新增数据（同事务不产生半写入）
------------------------------------------------------------------------------
>>> 请求：POST /api/materials，Content-Length: 11534623
<<< 响应 HTTP/1.1 413  {"error":{"code":"FILE_TOO_LARGE","message":"文件超过大小上限（10485760 字节）"}}
[断言通过] 413 且两表计数仍然不变

[汇总] 材料表 5 行，知识库表 1 行（上传前 4 / 0）
