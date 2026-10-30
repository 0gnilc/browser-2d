P0/P1 验收记录，2026-10-30。

P0 和 P1 已完成。经验证的代码提交为 `820d019893bca4a53578e945de2afa9523baeb5d`，分支为 `codex/p0-p1-monorepo`，未合并到 main。后续文档提交只记录验收证据，不改变已验证运行代码。

[最终四目标 CI](https://github.com/0gnilc/browser-2d/actions/runs/41133160522) 全部通过。每个目标执行锁定安装、格式与类型检查、边界检查、组件和 SQLite 测试、真实 Electron 测试、原生分发构建以及仓库外成品运行。Linux job 另外安装并运行生成的 Fedora 44 RPM。

| 目标        | 实际验收环境                                   | 产物                         | 结果                       |
| ----------- | ---------------------------------------------- | ---------------------------- | -------------------------- |
| Windows x64 | GitHub windows-2025 原生 runner                | NSIS EXE、可运行应用目录     | 通过                       |
| macOS x64   | GitHub macos-15-intel；本机 macOS 15.7.5 Intel | DMG、ZIP、应用目录           | 通过                       |
| macOS arm64 | GitHub macos-15 Apple Silicon                  | DMG、ZIP、应用目录           | 通过                       |
| Linux x64   | Ubuntu 24.04 原生 runner                       | AppImage、DEB、RPM、应用目录 | 通过                       |
| Fedora RPM  | Fedora 44 容器用户态，共享 CI 宿主内核         | 安装后的 RPM 应用            | 两次启动、持久化与关闭通过 |

Windows 的实际 CI 环境是 Windows Server runner，不等同于 Windows 11 实机覆盖。Fedora 结果证明 RPM 安装和用户态运行，不代表完整 Fedora 桌面、Wayland 或全部 Linux 发行版。最低系统版本、真实终端安装体验和正式发布支持范围在 P6 继续验证。

P0 的行为、表结构、身份和已知缺口记录在[静态基线](p0-baseline.md)。旧数据库未打开，未启动旧业务应用，未连接 AdsPower。缺列导入错误使用纯函数和人工字符串单独复现。旧流程后续事项由 [Issue #1](https://github.com/0gnilc/browser-2d/issues/1) 跟踪；本阶段由 [Issue #2](https://github.com/0gnilc/browser-2d/issues/2) 跟踪。

已交付的工程结构如下。

| 单元               | 本阶段实现                                                                 |
| ------------------ | -------------------------------------------------------------------------- |
| apps/ui            | Vue 3、Pinia、Naive UI、hash 路由、合成任务验收台、显式浏览器预览模式      |
| apps/desktop       | main、sandbox preload、受限 app 协议、IPC 来源校验、工作进程监督、打包配置 |
| apps/worker        | 私有编译入口、真实 SQLite 合成任务、完成/取消/恢复、关闭协议               |
| packages/contracts | 公共 DTO 和 API、Zod 校验、私有宿主协议                                    |
| internal           | 类型配置、lint 配置、构建预设、测试辅助                                    |
| scripts 与 CI      | 开发、检查、测试、隔离构建、三平台分发、ASAR/fuses/运行时验证              |

desktop 只生产依赖 worker 的编译运行包。better-sqlite3 由 worker 声明，contracts 打入消费方，根包不维护生产依赖副本。实际 ASAR 检查只允许 worker 的 dist 与 package.json，不允许 workspace 开发包或归档链接。该检查曾对额外源码配置报错，收紧 builder 文件过滤后通过。

本机和 CI 的测试覆盖如下。

| 检查               | 结果与范围                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------- |
| pnpm check         | 格式、ESLint、所有应用及 E2E 类型检查、运行时依赖边界通过                                   |
| pnpm test          | 3 个组件测试通过，覆盖发起任务、订阅释放、旧快照及错误状态                                  |
| pnpm test:storage  | 7 个真实 SQLite 测试通过，覆盖持久化、完成、冲突、取消、恢复及 schema 拒绝                  |
| pnpm test:electron | macOS/Linux 为 4 个场景通过；Windows 为 3 个通过，按平台跳过 POSIX SIGSTOP 场景             |
| 开发 HMR           | 真实 Electron 加载 Vite 来源，CSS 热更新后 worker PID 不变，任务正常完成                    |
| 开发 worker 重启   | 修改源文件时间触发重新构建，旧 PID 消失后新 PID 就绪；Ctrl-C 返回零并清理 worker            |
| 主流程             | 真实 UI→preload→main→utilityProcess→SQLite，取消、重启读取和关闭持久化通过                  |
| 来源隔离           | renderer 无 Node 全局能力；带 preload 的未授权窗口调用被拒绝                                |
| 故障路径           | worker 崩溃后请求不可用、重新启动记录为 interrupted；POSIX 无响应 worker 不被报告为正常关闭 |
| 成品验证           | 物理复制应用到仓库外，以独立数据目录连续启动两次，检查持久化和确认退出                      |
| 成品边界           | 检查 ASAR 文件范围、链接、实际 fuse 位、Electron 版本、平台与 CPU 架构                      |
| 生产模式           | 故意设置无效开发 URL 和原生模块覆盖路径，打包程序仍使用 app:// UI 与包内模块                |

P1 使用 better-sqlite3 13.0.3 的随包 Node-API 二进制。元数据与平台二进制检查已写入构建验证，Node 和 Electron 分别执行真实数据库测试。builder 不再执行无必要的原生重编译；驱动升级会要求显式更新原生验证策略。打包在隔离临时 workspace 中进行，不改写开发环境的原生依赖。

[验收台截图](assets/p1-foundation.png) 来自真实 Electron 测试，保存于关闭窗口前，展示正在运行与已取消的合成任务。关闭后的结果由持久化和退出断言验证。

本阶段实现的是合成定时任务。完整排队状态、通用命令查询、真实设备 CRUD、凭据存储、旧库迁移和浏览器驱动仍按 P2–P5 推进。P1 没有把示例状态或测试桥接伪装成已经迁移的业务功能。

产物来自 CI 的 `p1-win-x64`、`p1-mac-x64`、`p1-mac-arm64`、`p1-linux-x64` artifacts，保留七天。源码和锁文件可重新生成产物。本地 macOS x64 文件位于 `release/mac-x64/`，两种分发格式均已生成；DMG 挂载后取出的应用也经过仓库外两次运行验证。`artifacts/mac-x64/SHA256SUMS` 记录本地文件校验值，具体执行报告位于 `artifacts/mac-x64/package-pass-*.json`。

这是 P1 技术验证包，不是正式发行版。没有使用生产签名证书或 macOS 公证；Apple Silicon 仅执行修改 fuses 后所需的 ad-hoc 签名修复。NSIS 安装向导、AppImage/DEB 安装、生产更新、卸载和用户数据迁移不计为本阶段已验证。P6 的签名、更新和最终终端验收仍需完成。

在项目目录运行以下命令即可继续检查和开发。

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm check
pnpm test
pnpm test:storage
pnpm test:electron
pnpm dist -- --target=mac-x64
pnpm verify:package -- --target=mac-x64
```

打包目标必须匹配宿主 OS 和 CPU，其他目标使用对应 CI runner。普通开发使用 `artifacts/dev-data`，所有验收使用独立临时目录。真实 `~/kys/data.db` 和浏览器会话保持不动。

独立审阅发现的异常关闭误报、开发重启竞争和包路径包含检查问题已修复。已删除重复的测试环境注释。关键决策记录在[审计轨迹](../../.audit/p0-p1.tsv)。本阶段采用 Boundary Discipline 限定进程与包边界，使用 Sequence Work into Verifiable Units 按阶段推进，并按 Prove It Works 以实际进程和安装产物验收。

GitHub 内置连接器创建 PR 时返回 404，因此交付为已推送分支和 CI 记录，没有通过其他接口绕过该限制，也没有合并 main。该连接器问题不影响已执行的构建和平台验收。
