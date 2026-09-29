# 证据目录说明

| 文件 | 内容 | 生成方式 |
| --- | --- | --- |
| `login-request-response.md` | 登录成功/失败、会话读取、班级隔离、防会话固定、限流、登出失效共 11 个步骤的真实 HTTP 请求与响应原文 | `npm run capture:login` |
| `upload-request-response.md` | 教师上传入库、详情读取、下载校验、学生 403、跨班 404、超限 413 与两表计数对比 | `npm run capture:upload` |
| `01-login-light.png` | 登录页（浅色） | `npm run screenshots` |
| `02-login-dark.png` | 登录页（深色） | 同上 |
| `03-login-failed.png` | 登录失败统一提示 | 同上 |
| `04-materials-teacher.png` | 教师材料页（含上传区） | 同上 |
| `05-materials-student.png` | 学生材料页 | 同上 |
| `06-upload-success.png` | 上传成功提示（材料号 + 知识库条目号） | 同上 |

> 截图脚本使用本机已安装的 Chrome 或 Edge（`playwright-core` 驱动，无需额外下载浏览器）。
> 若浏览器安装在非默认路径，设置环境变量 `CHROME_PATH` 指向可执行文件即可。
