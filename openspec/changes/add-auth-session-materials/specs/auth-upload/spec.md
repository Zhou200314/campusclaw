# auth-upload 能力规格（delta）

## ADDED Requirements

### Requirement: 账号口令登录

系统 SHALL 提供账号口令登录接口，并在登录成功后通过会话 Cookie 建立服务端会话。

#### Scenario: 正确的账号与口令
- **WHEN** 客户端向 `POST /api/login` 提交存在的账号与正确口令
- **THEN** 返回 200，响应体包含该用户的 `displayName`、`role`、`classId`、`className`
- **AND** 响应头 `Set-Cookie` 下发会话 Cookie，属性包含 `HttpOnly` 与 `SameSite=Lax`

#### Scenario: 口令错误与账号不存在不可区分
- **WHEN** 客户端提交不存在的账号，或提交正确账号但错误口令
- **THEN** 两种情况返回完全一致的 401 响应体 `{"error":{"code":"INVALID_CREDENTIALS","message":"用户名或密码错误"}}`
- **AND** 两种情况的响应耗时不构成可区分的账号存在性信号

#### Scenario: 登录成功换发会话 ID
- **WHEN** 客户端在已有会话的情况下完成一次成功登录
- **THEN** 服务端删除原有会话行并签发新的会话 ID
- **AND** 登录前使用的会话令牌不再可用

### Requirement: 会话生命周期

系统 SHALL 由服务端管理会话，会话中的角色与班级不得由客户端声明。

#### Scenario: 携带有效会话访问受保护接口
- **WHEN** 客户端携带有效会话 Cookie 请求 `GET /api/me`
- **THEN** 返回 200，且返回的角色与班级来自服务端用户表

#### Scenario: 未登录访问受保护接口
- **WHEN** 客户端未携带会话 Cookie 请求 `GET /api/materials`
- **THEN** 返回 401
- **AND** 响应体不包含任何材料标题、正文或磁盘路径

#### Scenario: 登出后旧 Cookie 失效
- **WHEN** 客户端调用 `POST /api/logout` 后继续使用登出前的 Cookie 请求受保护接口
- **THEN** 返回 401

### Requirement: 登录失败限流

系统 SHALL 按「用户名 + IP」对连续登录失败限流，且限流响应与凭据错误响应同形。

#### Scenario: 超过失败阈值后被锁定
- **WHEN** 同一用户名与 IP 连续失败达到配置阈值（默认 5 次）
- **THEN** 锁定期内（默认 60 秒）返回与凭据错误完全一致的 401 响应
- **AND** 即使此后提交正确口令也被拒绝

### Requirement: 班级数据边界

系统 SHALL 以班级为租户边界，用户只能访问本班材料，班级取自服务端会话。

#### Scenario: 列表只包含本班材料
- **WHEN** 高一(1)班用户请求 `GET /api/materials`
- **THEN** 返回的材料全部属于高一(1)班，且不包含其它班级的标题

#### Scenario: 跨班按 ID 访问被拒绝
- **WHEN** 高一(1)班用户请求属于高一(2)班的材料 ID
- **THEN** 返回 404
- **AND** 响应体不包含对方的标题与正文
- **AND** 该响应与访问不存在的 ID 完全同形

### Requirement: 配置外置与失败即停

系统 SHALL 只从环境变量读取配置，必填项缺失时启动失败，且仓库与镜像不包含真实密钥。

#### Scenario: 缺少会话密钥
- **WHEN** 未设置 `SESSION_SECRET` 时启动服务
- **THEN** 进程以非零状态退出并打印缺少该变量的提示
- **AND** 不落到任何内置默认密钥

### Requirement: 角色能力边界

系统 SHALL 按角色授予能力：教师可查看、下载、上传；学生仅可查看与下载。

#### Scenario: 学生尝试上传
- **WHEN** 学生会话调用上传接口
- **THEN** 返回 403，且材料表与知识库表均不新增数据

#### Scenario: 教师上传入库
- **WHEN** 教师会话上传一份材料
- **THEN** 材料表与知识库表在同一事务内各新增一行
- **AND** 任一步失败时两张表都不发生变化
