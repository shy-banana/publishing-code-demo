# Java / Maven 发布验收样板

此分支用于发布平台的 Java 技术验收，固定 Spring Boot 3.5.7、源码 release 17，由管理员固定的 JDK 21 / Maven 工具链在隔离容器构建。

- `GET /` 返回 `Java/Maven publishing acceptance`，可区分构建语言与工具。
- `GET /health` 只读查询 `publishing_checks` 表；数据库与初始化表可用时返回 200、`status=ready`，否则返回 503 和固定短语。
- 默认绑定 `0.0.0.0:8080`；发布声明的就绪路径为 `/health`。
- `database/001-initial.sql` 保留自指定主分支，平台登录网关使用低权限业务数据库角色初始化；应用自身关闭 SQL 自动初始化。
- 数据库连接与统一登录由平台在运行时私密注入；源码不含数据库地址、账号、密码或 OIDC 凭据。

推送及源码识别通过不代表实际构建、部署或业务操作验收通过，服务器编译与启动验证另行记录。
