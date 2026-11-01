# P4 本机 Chrome 验收

记录日期为 2026-10-31。P4 验收已完成。最终运行与测试提交为 `4c9706e9654d138c7a72a577f4f70a39a89e51f4`，Windows、macOS Intel、macOS ARM 和 Linux 四目标矩阵全部通过。P5、P6 未推进。

[最终原生矩阵 41175541889](https://github.com/0gnilc/browser-2d/actions/runs/41175541889) 的完整结果保存在 `.audit/p4-ci.json`。后续提交只更新验收文档和证据。

## 实现范围

worker 使用 puppeteer-core 25.16.0 直连 Google Chrome。启动模式使用应用专属临时用户目录；借用模式连接显式配置的本机 HTTP 调试地址，每个任务创建隔离上下文。活动设置已移除 AdsPower 地址、API Key 和凭据操作。

调度限制两台设备、四个任务页面，并在接纳时冻结浏览器、页面数量和视口配置。取消和超时直接中止页面操作的等待。浏览器崩溃使任务失败，恢复只清理旧资源，不重放执行。

自有浏览器关闭前核验启动标记、用户目录、浏览器实例和进程身份。Windows Chrome 独立于 worker 的终止作业启动，恢复时仍需核验身份。已核验的浏览器退出但结果尚未落库时，恢复可通过其 PID 明确不存在的证据释放资源，不依据磁盘 PID 杀进程。

借用会话只清理任务上下文，保留原有标签页、Cookie 和存储。启动结果或上下文身份不确定时，保留清理失败状态和容量，不伪报完成。

004 迁移新增 Chrome 私有配置和资源台账，保留 001 至 003 的校验值、历史业务数据、旧凭据引用和加密文件。已迁移的停用凭据不再阻止 Chrome 启动。旧明文迁移仍先完成加密保存。

全部验证使用临时目录、人工数据和本地页面。未操作真实用户业务数据库，未创建 AdsPower 配置，未执行旧付款或订阅流程。

## 本轮收尾修复

原生诊断捕获了 `Target.attachToTarget: No target with given id found`。实际 Chrome 复现表明，Puppeteer 的发现列表可能包含其他客户端的临时 browser target。该客户端断开后，目标失效，但当前客户端的根连接仍可正常工作。浏览器级命令现使用经过类型核验的根 Connection，所有原有归属检查保持不变。内部连接入口集中在适配器中，并由固定依赖版本及真实跨客户端回归保护。

观察器原先会改写任务页面的视口，现在使用 `defaultViewport: null`。新增测试检查真实 `innerWidth` 和 `innerHeight`，确认观察前后四个页面均保持 1280×800。

原先固定三秒的任务可能在验证器观察到并发页面前结束。成品验证现使用私有的 pages-ready 检查点，先观察四个页面，再证明排队取消和活动取消，随后仅放行剩余任务。退出任务使用新的操作标识，保持活动直到桌面关闭。未改变正常任务时长、业务并发限制或公共 IPC。同一个延迟 Chrome 启动的复现场景，由失败且最多观察到三个页面，变为连续两轮通过。

Windows 的真实浏览器与 SQLite 测试文件现串行运行，避免跨文件资源竞争。测试超时、断言和用例内并发均未放宽。隔离探针复验连续两次通过全部 59 项测试；随后完整 Windows 矩阵通过。

## 测试结果

CI 使用 Node 24.22.1、pnpm 12.16.1、Electron 45.2.0，并单独提供 Chrome for Testing。本机补充验证使用 macOS Intel、Node 24.5.0 和 Google Chrome 156.0.8078.74，也使用 Chrome for Testing 156.0.8078.80 验证了根连接与 macOS 应用包目录问题。

| 检查                               | 结果                               |
| ---------------------------------- | ---------------------------------- |
| 格式、ESLint、TypeScript、依赖边界 | 通过，边界测试 30 项               |
| UI 组件                            | 22 项通过                          |
| SQLite、调度、资源与真实 Chrome    | 59 项通过                          |
| 旧凭据保存、设置与进程所有权       | 31 项通过                          |
| 观察器视口回归                     | 1 项通过                           |
| Electron，macOS/Linux              | 27 项通过                          |
| Electron，Windows                  | 25 项通过，2 项 POSIX 专用用例跳过 |
| 生产构建                           | 四目标通过                         |

Electron 测试覆盖启动后尚未连接、运行中、上下文创建后尚未保存身份、清理中发生 worker 崩溃，以及启动阶段取消。新增检查点用例验证逐操作放行、取消和重启清理。丢失借用上下文身份时，即使 Chrome 自动移除了上下文，台账仍保留不确定状态。

| 目标        | 原生分发包生成          | 脱离源码目录的成品运行                          |
| ----------- | ----------------------- | ----------------------------------------------- |
| macOS Intel | DMG、ZIP 通过           | 两轮通过                                        |
| macOS ARM   | DMG、ZIP 通过           | 两轮通过                                        |
| Windows x64 | NSIS 通过               | 两轮通过                                        |
| Linux x64   | AppImage、deb、rpm 通过 | 两轮通过；Fedora 44 中安装 RPM 后再运行两轮通过 |

每轮成品运行由独立观察器确认最多两台并发 Chrome、四个并发隔离任务页面。退出前再观察第三个 Chrome 实例及其两个任务页面，随后关闭桌面应用。全部已记录浏览器 PID 最终不存在，临时目录为空。验证器同时检查熔断配置、生产依赖、迁移资产和运行入口不依赖源码目录。

额外的 [Linux 修复探针 41174187218](https://github.com/0gnilc/browser-2d/actions/runs/41174187218) 连续通过五组双轮成品验证，共十次运行。

可重跑命令为 `pnpm check`、`pnpm test`、`pnpm test:storage`、`pnpm test:credentials`、`pnpm test:observer`、`pnpm test:electron`、`pnpm build`、`pnpm dist -- --target=<目标>` 和 `pnpm verify:package -- --target=<目标>`。测试和成品验证可通过 `BROWSER2D_CHROME_EXECUTABLE` 指定 Chrome。

本机日志位于 `artifacts/p4-finish-electron.log`、`artifacts/p4-finish-build.log`、`artifacts/p4-finish-package.log`。成品证据位于 `artifacts/mac-x64/`。原生矩阵归档名为 `p4-win-x64`、`p4-mac-x64`、`p4-mac-arm64`、`p4-linux-x64`，包含对应报告和分发包。

![Chrome 设置界面](assets/p4-settings.png)

## 复核与阶段边界

独立复核分别检查了私有检查点协议、被动观察器、根连接归属及上下文断连清理，未发现剩余可执行复现的代码问题。Fix Root Causes 用于替换错误的目标选择；Prove It Works 要求观察真实页面和进程，而非只检查容量字段。复核和决策证据在 `.audit/p4-review.md` 与 `.audit/p4.tsv`。

此前账户计费限制导致诊断任务未启动。仓库转为 public 且用户恢复验收后，Actions 已正常执行，先前 Windows/Linux 成品缺口已由最终矩阵关闭。

分支为 `codex/p4-browser`，未合并 main。内置 GitHub PR 连接器仍返回 403 `Resource not accessible by integration`，未创建 PR，记录在 `.audit/p4-finish-pr-connector-error.json`。签名、公证、自动更新和完整界面收尾属于后续阶段，本轮未推进。
