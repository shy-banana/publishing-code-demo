# TypeScript · Node.js 发布验收

来自 main `924f7d400db1947b29f862a8f3b07569d912dd2c` 的独立验收分支。

- `/`：中文验收页面，明确语言与框架。
- `/readyz`、`/healthz`：检查数据库可用性并返回语言、框架与版本标识。
- `/api/release`：版本标识及平台注入的真实提交 SHA。
- `/api/checks`：读取、关键词筛选和新增合成验收记录。
- `database/001-initial.sql` 保留基线原字节；仅使用现有表，不执行应用内结构迁移。
- `nativeOidc: false`，入口登录由平台网关保护。
- 数据库地址及 CA 证书路径只从平台环境读取；源码不包含凭据。
