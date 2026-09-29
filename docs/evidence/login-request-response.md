CampusClaw 迭代 1 · 登录与会话证据采集
目标服务：http://127.0.0.1:8080/
采集时间：2026-09-23T02:11:44.967Z

==============================================================================
步骤：用错误口令登录（teacher01 + wrong-password）
期望：401，统一失败提示，响应体不区分用户是否存在
------------------------------------------------------------------------------
>>> 请求
POST /api/login HTTP/1.1
Host: 127.0.0.1:8080
Content-Type: application/json
Content-Length: 52
Accept: application/json

{"username":"teacher01","password":"wrong-password"}
<<< 响应（97.2 ms）
HTTP/1.1 401 Unauthorized
Content-Type: application/json; charset=utf-8
Content-Length: 77
ETag: W/"4d-zSvs+fxXz2lD5z8mn5cs+7sXP0c"
Date: Wed, 23 Sep 2026 02:11:45 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"INVALID_CREDENTIALS","message":"用户名或密码错误"}}

==============================================================================
步骤：用不存在的账号登录（nosuchuser）
期望：401，响应体与上一步完全一致（防账号枚举）
------------------------------------------------------------------------------
>>> 请求
POST /api/login HTTP/1.1
Host: 127.0.0.1:8080
Content-Type: application/json
Content-Length: 50
Accept: application/json

{"username":"nosuchuser","password":"Teacher@123"}
<<< 响应（69.8 ms）
HTTP/1.1 401 Unauthorized
Content-Type: application/json; charset=utf-8
Content-Length: 77
ETag: W/"4d-zSvs+fxXz2lD5z8mn5cs+7sXP0c"
Date: Wed, 23 Sep 2026 02:11:45 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"INVALID_CREDENTIALS","message":"用户名或密码错误"}}

[断言通过] 用户不存在与口令错误的响应体完全一致

==============================================================================
步骤：用正确口令登录（teacher01）
期望：200，返回角色与班级，并通过 Set-Cookie 下发会话 Cookie
------------------------------------------------------------------------------
>>> 请求
POST /api/login HTTP/1.1
Host: 127.0.0.1:8080
Content-Type: application/json
Content-Length: 49
Accept: application/json

{"username":"teacher01","password":"Teacher@123"}
<<< 响应（75.4 ms）
HTTP/1.1 200 OK
Set-Cookie: cc_session=52ba574dc9e5605f5d632105e8636adec804723e085674dd4557b8ed95574ffa; Path=/; Max-Age=7200; HttpOnly; SameSite=Lax
Content-Type: application/json; charset=utf-8
Content-Length: 122
ETag: W/"7a-EJBriW0mhbRD+5nhLIwB4aRLjkI"
Date: Wed, 23 Sep 2026 02:11:45 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"user":{"id":1,"username":"teacher01","displayName":"王老师","role":"teacher","classId":1,"className":"高一(1)班"}}

[提示] 会话 Cookie：cc_session=52ba574dc9e5605f5d632105e8636adec804723e085674dd4557b8ed95574ffa
[提示] Set-Cookie 属性：cc_session=52ba574dc9e5605f5d632105e8636adec804723e085674dd4557b8ed95574ffa; Path=/; Max-Age=7200; HttpOnly; SameSite=Lax

==============================================================================
步骤：携带会话 Cookie 读取当前身份（GET /api/me）
期望：200，角色与班级来自服务端会话
------------------------------------------------------------------------------
>>> 请求
GET /api/me HTTP/1.1
Host: 127.0.0.1:8080
Accept: application/json
Cookie: cc_session=52ba574dc9e5605f5d632105e8636adec804723e085674dd4557b8ed95574ffa
<<< 响应（1.9 ms）
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Length: 122
ETag: W/"7a-EJBriW0mhbRD+5nhLIwB4aRLjkI"
Date: Wed, 23 Sep 2026 02:11:45 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"user":{"id":1,"username":"teacher01","displayName":"王老师","role":"teacher","classId":1,"className":"高一(1)班"}}

==============================================================================
步骤：携带会话 Cookie 读取本班材料（GET /api/materials）
期望：200，只返回高一(1)班材料
------------------------------------------------------------------------------
>>> 请求
GET /api/materials HTTP/1.1
Host: 127.0.0.1:8080
Accept: application/json
Cookie: cc_session=52ba574dc9e5605f5d632105e8636adec804723e085674dd4557b8ed95574ffa
<<< 响应（1.6 ms）
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Length: 351
ETag: W/"15f-ERzCIpP4azM+r1ytXiwO61/0fxU"
Date: Wed, 23 Sep 2026 02:11:45 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"classId":1,"className":"高一(1)班","canUpload":true,"items":[{"id":1,"title":"1班-函数与导数复习提纲","filename":"class1-functions.md","sizeBytes":null,"createdAt":"2026-09-23T02:11:32.367Z"},{"id":2,"title":"1班-期中文言文整理","filename":"class1-classical-chinese.md","sizeBytes":null,"createdAt":"2026-09-23T02:11:32.367Z"}]}

==============================================================================
步骤：跨班按 ID 访问（GET /api/materials/3，属于高一(2)班）
期望：404，不返回对方的标题与正文
------------------------------------------------------------------------------
>>> 请求
GET /api/materials/3 HTTP/1.1
Host: 127.0.0.1:8080
Accept: application/json
Cookie: cc_session=52ba574dc9e5605f5d632105e8636adec804723e085674dd4557b8ed95574ffa
<<< 响应（1.3 ms）
HTTP/1.1 404 Not Found
Content-Type: application/json; charset=utf-8
Content-Length: 58
ETag: W/"3a-jep09IeZHKyTO7SPD28yWuvoJi8"
Date: Wed, 23 Sep 2026 02:11:45 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"NOT_FOUND","message":"材料不存在"}}

==============================================================================
步骤：用学生账号登录（student01）
期望：200，角色为 student
------------------------------------------------------------------------------
>>> 请求
POST /api/login HTTP/1.1
Host: 127.0.0.1:8080
Content-Type: application/json
Content-Length: 49
Accept: application/json

{"username":"student01","password":"Student@123"}
<<< 响应（72.1 ms）
HTTP/1.1 200 OK
Set-Cookie: cc_session=960d68a9ed529d177a761c26be400cab8beed12f058d280da1f0fd83d942ad47; Path=/; Max-Age=7200; HttpOnly; SameSite=Lax
Content-Type: application/json; charset=utf-8
Content-Length: 122
ETag: W/"7a-jDTA5IXoNU54Utw9hGxJ0RMvb+Q"
Date: Wed, 23 Sep 2026 02:11:45 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"user":{"id":2,"username":"student01","displayName":"李同学","role":"student","classId":1,"className":"高一(1)班"}}

==============================================================================
步骤：学生读取材料（GET /api/materials）
期望：200，学生可查看本班材料
------------------------------------------------------------------------------
>>> 请求
GET /api/materials HTTP/1.1
Host: 127.0.0.1:8080
Accept: application/json
Cookie: cc_session=960d68a9ed529d177a761c26be400cab8beed12f058d280da1f0fd83d942ad47
<<< 响应（1.4 ms）
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Length: 352
ETag: W/"160-yopCHNZFs9aM31ZhyCF41P3RoFY"
Date: Wed, 23 Sep 2026 02:11:45 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"classId":1,"className":"高一(1)班","canUpload":false,"items":[{"id":1,"title":"1班-函数与导数复习提纲","filename":"class1-functions.md","sizeBytes":null,"createdAt":"2026-09-23T02:11:32.367Z"},{"id":2,"title":"1班-期中文言文整理","filename":"class1-classical-chinese.md","sizeBytes":null,"createdAt":"2026-09-23T02:11:32.367Z"}]}

==============================================================================
步骤：登出（POST /api/logout）
期望：204，服务端删除会话并清除 Cookie
------------------------------------------------------------------------------
>>> 请求
POST /api/logout HTTP/1.1
Host: 127.0.0.1:8080
Accept: application/json
Cookie: cc_session=960d68a9ed529d177a761c26be400cab8beed12f058d280da1f0fd83d942ad47
<<< 响应（2.8 ms）
HTTP/1.1 204 No Content
Set-Cookie: cc_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax
Date: Wed, 23 Sep 2026 02:11:45 GMT
Connection: keep-alive
Keep-Alive: timeout=5

(空响应体)

==============================================================================
步骤：登出后用旧 Cookie 再访问（GET /api/me）
期望：401，旧 Cookie 立即失效
------------------------------------------------------------------------------
>>> 请求
GET /api/me HTTP/1.1
Host: 127.0.0.1:8080
Accept: application/json
Cookie: cc_session=960d68a9ed529d177a761c26be400cab8beed12f058d280da1f0fd83d942ad47
<<< 响应（1.4 ms）
HTTP/1.1 401 Unauthorized
Content-Type: application/json; charset=utf-8
Content-Length: 76
ETag: W/"4c-W2fxP7vMtq207rejRqRvC8WJjFw"
Date: Wed, 23 Sep 2026 02:11:45 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"UNAUTHENTICATED","message":"未登录或会话已失效"}}

==============================================================================
步骤：未登录访问受保护接口（GET /api/materials）
期望：401，响应体不含任何材料标题或正文
------------------------------------------------------------------------------
>>> 请求
GET /api/materials HTTP/1.1
Host: 127.0.0.1:8080
Accept: application/json
<<< 响应（0.7 ms）
HTTP/1.1 401 Unauthorized
Content-Type: application/json; charset=utf-8
Content-Length: 76
ETag: W/"4c-W2fxP7vMtq207rejRqRvC8WJjFw"
Date: Wed, 23 Sep 2026 02:11:45 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"UNAUTHENTICATED","message":"未登录或会话已失效"}}

==============================================================================
步骤：已有会话时再次登录，验证换发新会话 ID（防会话固定）
期望：会话 Cookie 值改变，且登录前的旧 Cookie 立即失效
------------------------------------------------------------------------------
>>> 携带旧 Cookie 再次登录：POST /api/login（teacher01）
<<< 响应 200，新 Cookie：cc_session=7321b9401cfd3608f78ad0826985b7063f4c9d1f04093be046612ef2242b34f2
旧 Cookie：cc_session=52ba574dc9e5605f5d632105e8636adec804723e085674dd4557b8ed95574ffa
[断言通过] 会话 ID 已换发
>>> 用登录前的旧 Cookie 请求 GET /api/me
<<< 响应 401 {"error":{"code":"UNAUTHENTICATED","message":"未登录或会话已失效"}}
[断言通过] 旧会话已作废

==============================================================================
步骤：连续失败触发登录限流（用户名 + IP 维度）
期望：达到阈值后被锁定，锁定期内即使口令正确也返回与凭据错误一致的 401
------------------------------------------------------------------------------
第 1 次错误口令 -> 401 {"error":{"code":"INVALID_CREDENTIALS","message":"用户名或密码错误"}}
第 2 次错误口令 -> 401 {"error":{"code":"INVALID_CREDENTIALS","message":"用户名或密码错误"}}
第 3 次错误口令 -> 401 {"error":{"code":"INVALID_CREDENTIALS","message":"用户名或密码错误"}}
第 4 次错误口令 -> 401 {"error":{"code":"INVALID_CREDENTIALS","message":"用户名或密码错误"}}
第 5 次错误口令 -> 401 {"error":{"code":"INVALID_CREDENTIALS","message":"用户名或密码错误"}}
锁定期内使用正确口令 -> 401 {"error":{"code":"INVALID_CREDENTIALS","message":"用户名或密码错误"}}
[断言通过] 锁定期响应与凭据错误完全同形，且不因口令正确而放行
