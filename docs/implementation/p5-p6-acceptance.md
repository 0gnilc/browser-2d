# P5/P6 验收记录

本轮按已确认的[重构方案](../monorepo-refactor-plan.md)完成界面、开发体验与发布工程。用户在本轮明确说明签名、公证及 HTTPS 更新源尚未准备，要求完成工程并保留正式发布验收缺口。P5 已通过最终验收。P6 发布工程和四目标预览验收已通过，正式分发仍未完成。

当前实现提交为 `f52238f4e54117649cfeee710ed336d0724dba67`。分支为 `codex/p5-p6-finish`，基于已验收 P4 的 `2c6fd8b`。所有运行数据均为隔离临时目录中的合成记录。浏览器继续使用 Google Chrome 与 puppeteer-core。没有恢复 AdsPower、真实账户操作、购买流程或材料消费。

## P5 路由与开发体验

| 流程       | 实现与验收                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 页面与导航 | 五个路由使用 TypeScript、Pinia 和 Naive UI。移除阶段验收标题，保留本地验证任务的真实用途说明。设置页增加手动更新状态。                                                        |
| 设备       | 新增、编辑、零金额、取消删除确认、删除、单设备启动和取消均通过真实界面操作。选中设备批量启动、停止活动任务分别显示逐项回执。                                                  |
| 批量指令   | 已受理、拒绝、未知和未发送分别显示。未知结果停止后续发送，保留原 commandId 查询或重试。重连将发送中的结果改为未知，旧会话迟到响应不能覆盖新状态。组件测试覆盖混合结果与重连。 |
| 材料       | 合成混合导入逐行显示结果，实际提交数与落库一致。22 行数据覆盖分页、状态 0、重置筛选、编辑、重置保留金额和删除确认取消。                                                       |
| 历史       | 真实路由筛选包含日期边界，导出整个匹配集合。Electron 原生下载事件捕获生成的 history.txt，并检查文件字节。保留旧 day/year 兼容规则。                                           |
| 设置       | Naive 表单保留 Chrome 启动/借用模式、视口、页数和版本冲突语义。预览应用明确显示更新不可用。                                                                                   |
| 订阅       | App 生命周期持有唯一工作订阅。反复切换路由保留状态和未知指令，卸载释放订阅。更新订阅拒绝旧版本状态并在卸载时释放。                                                            |
| 布局       | 实际桌面截图和 720px 窄窗口检查。横向滚动限制在表格内，页面没有横向溢出。                                                                                                     |
| HMR        | CSS 和 Vue 模板修改后，实际页面更新且 worker PID 保持不变。                                                                                                                   |
| 协调重启   | worker 源码和共享 TypeScript 预设变化触发构建后重启。原进程退出后才能替换。构建失败保留旧进程，关闭失败阻止替换。                                                             |

根目录旧 Forge、旧 Vite、HTML、JS 配置、Element Plus 自动声明及无引用图标已删除。VS Code 启动使用 pnpm dev。边界检查拒绝旧入口、旧依赖以及越层导入。发布通用配置归属 internal/build-config，通过明确导出供 builder 使用。

开发配置最后复查发现 Vite 服务持有旧配置的问题。隔离的真实 Vite 复现中，生产产物已变为 after，重启后的开发页面仍返回 before。修复后通过 Vite 重新加载 preset，并在旧应用干净退出后重建服务。新增真实 Electron 插件配置回归，加上原有 4 项开发测试，共 5 项通过。Vite runnerImport 为实验性导出，当前固定 8.3.5，升级时需重跑该回归。

## P6 发布工程

- 更新状态和命名方法属于公共 DTO，主进程负责更新，worker 不接收更新命令。IPC 继续校验窗口和 frame。UI 无法指定 feed、安装器路径或原始 IPC。
- 固定 electron-updater 6.8.11。检查、下载、确认安装相互独立，关闭应用不自动安装。稳定渠道显式拒绝预发布版本，避免依赖 generic provider 不执行的 allowPrerelease 策略。
- 安装请求先同步关闭工作接纳，再等待现有 worker.close 和资源清理。成功后才进入安装器退出路径。清理失败或安装器错误保持可见失败状态，不能把失败当作正常更新。
- 更新源来自构建时写入的资源。正式配置只允许无凭据、查询或片段的 HTTPS 地址。开发和预览禁用更新。Linux 系统包标记优先于 APPIMAGE 环境变量，DEB/RPM 使用包管理器。
- package/dist 显式区分 preview 与 production。预览剔除签名环境变量。正式候选要求干净提交、版本、目标、渠道、feed 和相应签名输入。macOS DMG 公证与 stapling 完成后才记录最终哈希。
- release:verify 校验最终文件、更新元数据、大小/摘要/版本、原生签名以及绑定源提交和文件清单的外部验收证据。缺项拒绝产生正式回执。
- release:prepare 重新校验四目标回执和文件字节，只准备待上传目录。它不重建、不签名、不上传。release 明确拒绝未配置的线上发布。

关键界面见[任务](assets/p5-tasks-desktop.png)、[设备](assets/p5-devices.png)、[材料](assets/p5-materials-desktop.png)、[历史](assets/p5-history-desktop.png)及[窄窗口设置与更新](assets/p5-settings-narrow.png)。这些截图来自实际 Electron 测试，数据均为合成记录。

详见[开发指南](../development.md)及[发布工程](../release.md)。应用 appId、产品名、可执行文件名和业务数据路径保持原值。没有把未知的旧安装身份推断为兼容。

## 本地执行结果

本机为 macOS Intel，Node 24.5.0、pnpm 12.16.1。精确依赖来自锁文件。以下命令已实际执行。

| 检查                  | 结果                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| pnpm check            | 格式、ESLint、TypeScript、Vue 类型检查通过，36 项边界测试通过。                                                              |
| pnpm test             | 30 项组件测试通过。                                                                                                          |
| pnpm test:storage     | 59 项存储、调度和真实 Chrome 测试通过。                                                                                      |
| pnpm test:credentials | 31 项凭据和进程所有权测试通过。                                                                                              |
| pnpm test:updates     | 27 项通过。包含真实 pinned updater 的 loopback HTTP 下载，404、SHA512 错误、重试和旧文件保留。                               |
| pnpm test:release     | 22 项通过。包含 updater catalog 打包版本、同大小字节改写、缺失元数据、未知 Squirrel、日志摘要、符号链接及 staging 路径拒绝。 |
| pnpm test:observer    | 1 项真实 Chrome 页面尺寸观察测试通过。                                                                                       |
| pnpm test:electron    | 30 项通过，包含构建、真实 IPC/UI、开发重启、浏览器崩溃恢复和退出清理。                                                       |

更新 transport fixture 下载的是不可执行的合成文件，没有执行安装器。它证明实际库的版本检查、下载和摘要行为，不证明 HTTPS 信任或安装 N→N+1。生命周期测试证明清理与安装调用的顺序，不代替实际签名更新验收。

## 原生预览验收

当前四目标运行见 [Actions 41184202293](https://github.com/0gnilc/browser-2d/actions/runs/41184202293)。前一实现提交 `ad869d7` 的四目标矩阵已通过 [Actions 41182001465](https://github.com/0gnilc/browser-2d/actions/runs/41182001465)。最后补齐 renderer 配置重载后，最终提交的四个目标均在第 1 次运行通过。

上一轮 `175c54e` 的 Windows 和两种 macOS 全部通过。Linux 的 DEB 安装发现 runner 缺少包声明的 libnotify4，已将安装脚本改用 apt-get 解析依赖。在 `ad869d7` 的第 1 次运行中，Windows 有一次原有 v3 迁移用例超过 Vitest 默认 5000ms，报告 5737ms，其他 58 项工作模块测试通过。工作模块代码、测试、超时和断言均未改变；具体耗时来源未确定，按独立诊断建议原样重跑该失败任务；重跑已通过完整 Windows 原生验收，该轮最终四目标全部成功。首次失败仍保留为暂时性测试超时，不把耗时原因写成已确定。

| 目标                | 原生构建与测试              | 仓库外启动 | 安装、同版本重装、卸载及数据保留                      |
| ------------------- | --------------------------- | ---------- | ----------------------------------------------------- |
| Windows x64         | 通过，Server 2025 runner    | 2 次通过   | NSIS 安装目录 4 次启动通过                            |
| macOS Intel         | 通过，macOS 15 Intel runner | 2 次通过   | DMG 安装目录 4 次启动通过                             |
| macOS Apple Silicon | 通过，macOS 15 ARM runner   | 2 次通过   | DMG 安装目录 4 次启动通过                             |
| Linux x64           | 通过，Ubuntu 24.04 runner   | 2 次通过   | DEB 安装目录 4 次启动通过，Fedora 44 RPM 两次运行通过 |

本机新预览包已完成 2 次仓库外启动和 4 次安装目录启动。该构建在打包兼容修复提交前启动，build-context 记录 `3031074` 与 `dirty: true`，不冒充最终 `f52238f` 的精确提交原生矩阵证据。

安装脚本从实际 DMG/NSIS/DEB 安装，在安装位置运行两次，再卸载、以同一临时数据库重装并运行两次。卸载前后核对数据库摘要。此流程是同版本重装，不是 N→N+1 升级。Windows/Linux 安装脚本只在一次性 CI runner 执行。macOS 使用专属临时安装目录。

最终 CI 每个目标均通过格式、类型和边界检查、30 项组件、59 项存储/Chrome、31 项凭据、27 项更新、22 项发布工具及 1 项浏览器观察测试。Electron 完整套件在 macOS/Linux 通过 31 项，在 Windows 通过 29 项并跳过 2 项 POSIX 专用用例；Windows 的可移植关闭与恢复用例均运行。

原生产物的 build-context、文件哈希清单、安装与运行摘要已归档到 [.audit/p5-p6-evidence](../../.audit/p5-p6-evidence)。目标均绑定 `f52238f` 和同一锁文件，构建工作区为干净状态。汇总见 [.audit/p5-p6-ci.json](../../.audit/p5-p6-ci.json)。CI 附件保留期为 7 天，归档记录不含安装包二进制。

另用同一批已构建文件完成 [AppImage/ZIP 补核](https://github.com/0gnilc/browser-2d/actions/runs/41185989791)。Linux AppImage 通过直接 FUSE 启动，两次 worker 路径均位于真实 /.mount_ 目录。两种 macOS 架构的 ZIP 解压应用也各启动两次。三项都通过真实 Chrome 观察、数据跨重启持久化、取消和进程退出检查。补核使用独立诊断分支 `codex/p6-extra-formats`，校验原始产物的完整清单和哈希，没有重建应用，也没有修改主实现分支。

## 尚未通过的正式分发条件

以下条件按用户本轮决定保留，不属于已通过结果。

1. Windows Authenticode 和 macOS Developer ID 签名、公证、最终签名产物的原生验收。
2. 配置可信 HTTPS feed，使用真实 N、N+1 最终产物完成检查、失败重试、安装、重启及数据保留。macOS 两种架构分别验收。DEB/RPM 需要实际版本升级。
3. Windows 11 安装和卸载验收。当前托管 CI 是 Windows Server 2025，不能替代 Windows 11。
4. 已分发旧 Squirrel 安装器的身份与实际样本。未知状态保持未通过，不能证明快捷方式、注册信息、卸载和迁移兼容。
5. 实际发布目的地、上传权限和发布最终同一批文件。当前没有上传、部署或合并 main。

独立复核及修复记录见 [.audit/p5-p6-review.md](../../.audit/p5-p6-review.md)。模型复核通过不替代上述真实平台证据。

代码分支已推送。内置 GitHub PR 连接器返回 403 Resource not accessible by integration，未创建 PR。没有合并 main。
