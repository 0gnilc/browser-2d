Electron 技术选型调研，2026-10-30。

基于本调研整理的当前实施设计见[最终重构方案](../monorepo-refactor-plan.md)。本文件保留选型证据与备选比较，具体职责、依赖和验收以该方案为准。

目标是在不受现有框架限制的前提下，为 browser-2d 选择 Electron 技术栈。已确定使用 pnpm monorepo，区分 UI、桌面宿主和工作模块，通过 internal 管理工程基础能力。关闭桌面窗口后停止任务，首期覆盖 Windows、macOS、Linux。本文件是研究建议，不是已批准的实施规范。没有安装依赖、运行应用或修改业务代码。

针对当前以设备管理、表格、配置表单和任务状态为主的产品，推荐 TypeScript、Vue 3、Pinia、Naive UI、electron-vite、electron-builder、better-sqlite3 和 Electron utilityProcess。选择依据是职责边界、开发和发布流程，以及当前产品形态。没有证据证明这套组合在所有 Electron 产品中都优于其他方案。

调研核查了七个项目的源码、依赖清单或构建配置。下表记录的是默认开发分支快照，不能据此断言最新稳定安装包使用相同依赖。Stars 仅用于确认样本具有一定关注度，不参与选型评分。

| 项目 | 已核实的技术组合 | 本项目可借鉴的内容 |
| --- | --- | --- |
| [Cherry Studio](https://github.com/CherryHQ/cherry-studio/blob/d73c97fce5993eed88e05031aae07154f04b4f35/package.json) | React 19、TypeScript、pnpm、electron-vite、electron-builder | 工作区、类型化 IPC、原生依赖及发布链路。其自定义缓存和生命周期系统不适合整套复制 |
| [AFFiNE](https://github.com/toeverything/AFFiNE/blob/8cef09e1dd62b47a3cbc9f352aa10b3a90c75d34/packages/frontend/apps/electron/package.json) | React、Yarn、esbuild、Forge、electron-updater | 工作辅助进程、消息端口和应用退出清理。协作编辑与 Rust 存储超出当前需求 |
| [Joplin](https://github.com/laurent22/joplin/blob/2e1310190489c5325dd69305bb762e887865c6c3/packages/app-desktop/package.json) | React、Redux、Yarn、Gulp、esbuild、electron-builder | 桌面测试、不同平台的安装与更新策略。其既有构建和 renderer 权限设置不是新项目的默认模板 |
| [FreeTube](https://github.com/FreeTubeApp/FreeTube/blob/310f5fcd8574404590412be269a90d75dc8c2bb4/package.json) | Vue 3、Vuex 4、pnpm、Webpack、electron-builder | Vue 桌面产品、方法式 preload 和三平台分发。存在 pnpm 配置不等于已经采用多包 monorepo |
| [Beekeeper Studio](https://github.com/beekeeper-studio/beekeeper-studio/blob/d8a59d3f0a8992281eb45935d5bb818b8328ec09/apps/studio/package.json) | Vue 2.7、Vuex 3、Vite、esbuild、better-sqlite3、electron-builder | 数据密集界面、工作进程和桌面测试矩阵。Vite 的使用不能作为 Vue 3 的证据 |
| [AlgerMusicPlayer](https://github.com/algerkong/AlgerMusicPlayer/blob/f57204d4205769a4457f5975796a35e41785f1d8/package.json) | Vue 3、Pinia、TypeScript、Naive UI、electron-vite、electron-builder | 现代 Vue 桌面组合。其未签名 macOS 配置和通用 IPC 暴露方式不应直接沿用 |
| [VS Code](https://github.com/microsoft/vscode/blob/81037a8870c17a790a7995647b6d666194d19f72/package.json) | TypeScript、自有工作台、自定义构建与测试流程 | 进程监督与可释放资源。为大型编辑器建设的构建系统没有必要复制到本项目 |

各快照的完整提交如下，便于之后复查。

| 项目 | 分支 | SHA |
| --- | --- | --- |
| Cherry Studio | main | d73c97fce5993eed88e05031aae07154f04b4f35 |
| AFFiNE | canary | 8cef09e1dd62b47a3cbc9f352aa10b3a90c75d34 |
| Joplin | dev | 2e1310190489c5325dd69305bb762e887865c6c3 |
| FreeTube | development | 310f5fcd8574404590412be269a90d75dc8c2bb4 |
| Beekeeper Studio | master | d8a59d3f0a8992281eb45935d5bb818b8328ec09 |
| AlgerMusicPlayer | main | f57204d4205769a4457f5975796a35e41785f1d8 |
| VS Code | main | 81037a8870c17a790a7995647b6d666194d19f72 |

推荐的技术分工如下。表内“推荐”是针对本项目的判断。

| 能力 | 推荐 | 取舍 |
| --- | --- | --- |
| UI | Vue 3、TypeScript、Pinia、Naive UI | 表格、表单和任务状态为主，优先完整业务组件。Pinia 管理 UI 状态和工作状态快照，不拥有调度规则 |
| UI 备选 | React、Zustand、Ant Design | 熟悉 React 的团队可以采用。当前没有可验证的需求要求重写为 React |
| 现有组件迁移 | Element Plus 可以保留 | Naive UI 是重新设计时的默认偏好，不能声称更换组件库会提高自动化稳定性 |
| 构建 | electron-vite 与 Vite | main、preload、renderer、工作入口有显式构建配置 |
| 打包与更新 | electron-builder 26 稳定线、electron-updater | 统一规划安装器、签名、更新元数据，保留平台差异 |
| 包管理 | pnpm workspace、workspace 协议、catalog | 初始采用默认隔离布局。版本集中、依赖显式声明，内部源码打进应用产物 |
| 工作宿主 | utilityProcess | 调度、业务仓储和数据库放在工作进程，主进程不执行同步数据库查询 |
| 本地数据库 | SQLite、better-sqlite3、版本化 SQL 迁移 | 业务量尚小，先保留明确的 SQL 和事务。Drizzle 是查询复杂后可选的类型化访问层 |
| IPC | contextBridge、命名业务方法、Zod | 对入参和来源做边界检查，订阅返回取消函数，不暴露任意 IPC 调用能力 |
| 浏览器控制 | puppeteer-core | 适配当前连接 AdsPower 浏览器的用法。Playwright 用于测试，不因测试选型而重写生产自动化 |
| 测试 | Vitest、Vue Test Utils、Playwright、最终成品冒烟检查 | 各自覆盖逻辑、组件、桌面交互和发布产物 |
| 日志与凭据 | electron-log、Electron safeStorage | 日志携带 runId 和 deviceId。凭据加密由桌面系统适配层处理，工作进程按需获取 |
| 规范 | ESLint、Prettier、tsc、vue-tsc | 采用一套规范流程，类型检查不依赖 Vite 构建是否成功 |

Vue 和 React 都有生产应用样本。样本不能证明其中一个更快或更稳定。本项目推荐 Vue 3 是产品适配判断。Naive UI 提供 TypeScript 实现及类型化主题配置，适合作为新界面的候选；现有 Element Plus 也有完整表格与表单能力。组件库替换应由界面重构范围决定，而不是由 monorepo 迁移强制触发。[Naive UI](https://github.com/tusen-ai/naive-ui)、[Element Plus 表格](https://element-plus.org/en-US/component/table.html)

本轮修正了上轮关于 Forge 的一项依据。Forge 8.0.1 发布说明明确将 Vite 插件提升为稳定支持，并纳入 semver。其网站 Vite 页面仍保留旧版实验性说明。Forge 8 是可用备选，不能再以插件实验性排除它。[Forge 8 发布说明](https://github.com/electron/forge/releases/tag/v8.0.1)

这里优先推荐 electron-vite 加 electron-builder，是因为当前 builder 26 已有专门的 pnpm 依赖收集器，处理隔离布局的符号链接、Windows junction 和 workspace 根目录。其源码也处理 pnpm 11 之后的多工作区输出。这比默认增加 hoist 或自建生产依赖复制流程更适合作为起点。源码支持仍不能代替本项目依赖图的成品验证。[builder 26.18.0 pnpm 收集器](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.18.0/packages/app-builder-lib/src/node-module-collector/pnpmNodeModulesCollector.ts)、[工作区根目录定位](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.18.0/packages/app-builder-lib/src/node-module-collector/index.ts)

构建工具负责产物，打包器负责分发，两者可独立选择。AFFiNE 同时使用 Forge 和 electron-updater，是这一区别的实际例子。electron-builder 的推荐不代表 Forge 不支持更新。[AFFiNE Forge 配置](https://github.com/toeverything/AFFiNE/blob/8cef09e1dd62b47a3cbc9f352aa10b3a90c75d34/packages/frontend/apps/electron/forge.config.mjs)

版本信息必须与对应文档匹配。本轮 registry 查询观察到 Electron 45.2.0、electron-vite 6.0.0、Forge CLI 8.0.1、pnpm 12.16.1。builder 的 npm latest 为 26.18.0，v26 标签指向 26.18.1，而网站默认展示尚未正式发布的 v27。上述信息不是已经测试的兼容矩阵。实施时选择稳定版本并固定精确版本，不直接组合全部 latest。[electron-vite 6](https://github.com/alex8088/electron-vite/releases/tag/v6.0.0)、[Electron 45.2.0](https://github.com/electron/electron/releases/tag/v45.2.0)、[builder registry](https://registry.npmjs.org/electron-builder)、[builder v26 文档](https://www.electron.build/v26/docs/)

SQLite 仍适合当前本地查询和任务历史。原 sqlite3 上游已于 2026-07-01 归档并声明不再维护，因此目标驱动选择 better-sqlite3。其同步 API 应由工作进程执行，查询和批量操作需要设置合理边界。Node 的 node:sqlite 仍有版本相关的稳定性和 API 差异，不能根据开发机的 Node 版本推断 Electron 内置运行时可用。[sqlite3 上游](https://github.com/TryGhost/node-sqlite3)、[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)、[Node SQLite 文档](https://nodejs.org/api/sqlite.html)

Drizzle 支持 better-sqlite3，并提供 SQL 迁移生成和执行能力。当前不把 ORM 作为第一阶段必选项。业务仓储先隐藏驱动；查询复杂后可以采用 Drizzle，而无需改变 UI 的 IPC 契约。如果采用，迁移 SQL 应进入版本控制并接受审阅，用户数据库执行已发布迁移，不在应用启动时使用开发期 schema push。[Drizzle SQLite 驱动](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/better-sqlite3/driver.ts)、[迁移方式](https://orm.drizzle.team/docs/migrations)

目标结构继续采用 apps/desktop、apps/ui、apps/worker 和 packages/contracts。internal 放 TypeScript、构建、lint、测试基础设施。桌面入口、preload、系统凭据接口、打包元数据归 desktop。工作进程内的 storage 管理业务仓储和 SQLite。打包依赖清单的归属与运行时数据库的归属不同，不能因此把数据库查询放回 Electron 主进程。

utilityProcess 为工作模块提供独立 Node 进程和消息端口。默认目标是一个工作宿主内受控的异步并发。额外 worker_threads 用于明确的 CPU 工作或独立执行终止需求，不把设备数量直接映射成线程数量。现有线程模型的改变必须经过取消、失败隔离和任务语义的行为验证。[Electron utilityProcess](https://github.com/electron/electron/blob/v45.2.0/docs/api/utility-process.md)、[Node worker_threads](https://nodejs.org/api/worker_threads.html)

VS Code 实际封装了 utilityProcess，AFFiNE 也用辅助进程和 MessagePorts，并在退出时清理它们。这支持参考进程边界，不要求复制它们的服务容器或 RPC 框架。[VS Code 进程实现](https://github.com/microsoft/vscode/blob/81037a8870c17a790a7995647b6d666194d19f72/src/vs/platform/utilityProcess/electron-main/utilityProcess.ts)、[AFFiNE 辅助进程](https://github.com/toeverything/AFFiNE/blob/8cef09e1dd62b47a3cbc9f352aa10b3a90c75d34/packages/frontend/apps/electron/src/main/helper-process.ts)

关闭主业务窗口时，三个平台都应进入统一关闭流程。先停止接收任务，取消执行并释放本应用管理的浏览器资源，再关闭数据库和工作进程，最后退出 Electron。超时或异常结束的任务记录为中断。不能照搬音乐播放器在 macOS 上隐藏窗口后继续运行的行为。工作进程退出也不自动证明外部浏览器任务已停止。AdsPower 会话需要明确资源所有权与停止操作，并通过可控集成测试验证。

renderer 保持 sandbox 和 contextIsolation，禁用 Node 集成。preload 只提供业务方法，校验 IPC 发送方，事件中只传递数据。本地 UI 与自动化访问的网站应保持权限隔离。safeStorage 只能在主进程调用，其平台语义不同，Linux 缺少可用 secret store 时不能静默宣称凭据已获得相同保护。[Electron 安全指导](https://www.electronjs.org/docs/latest/tutorial/security)、[safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

electron-log 可以记录桌面日志，也有 Node 入口。utilityProcess 日志不会自动转发到主进程，需要显式设计转发或分进程日志文件。记录运行标识和错误分类，避免把凭据与完整业务记录写入日志。[electron-log](https://github.com/megahertz/electron-log)

开发入口使用 pnpm dev 启动完整桌面链路。UI 使用 HMR，工作进程及主进程代码变化时协调退出后重启。浏览器预览使用明确的测试桥接。类型检查、测试、编译、打包和发布保持独立命令。普通开发与 CI 使用独立数据库和可控浏览器目标，不依赖用户真实环境。

main 和工作入口采用明确的 Node 产物格式，preload 打成适合 sandbox 的单个 CommonJS bundle。内部 workspace 源码打进消费方产物，安装后不需要仓库链接或原始 TypeScript。原生 SQLite 模块保持 external，并对目标平台、架构及 Electron 运行时验证加载。[electron-vite 依赖处理](https://electron-vite.org/guide/dependency-handling)、[Electron 原生模块](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)

三平台分发建议如下。这是目标选择，不是已经通过的兼容性声明。CPU 架构仍需在实施计划中明确。

| 平台 | 建议产物 | 发布验证 |
| --- | --- | --- |
| Windows | 签名 NSIS 安装器 | 安装、升级、卸载、数据保留、任务关闭。若已有 Squirrel 用户，单独设计安装器迁移 |
| macOS | 签名并公证的 DMG 与更新 ZIP | 安装、签名、公证、权限、升级和关闭窗口行为 |
| Linux | AppImage，另提供 DEB 与 RPM | 明确支持发行版、运行库和 AppImage runtime，区分应用更新与系统包管理更新 |

electron-updater 支持 Windows NSIS、macOS 和若干 Linux 格式。macOS 更新需要签名与对应 ZIP。DEB、RPM 是否使用应用内更新，应根据安装渠道和权限确定，不能把 AppImage 的行为直接套用。当前 builder 26 的 AppImage runtime 还有 FUSE2 与可选新 runtime 的区别，需要对目标 Linux 环境验证。[自动更新](https://www.electron.build/v26/docs/features/auto-update/)、[跨平台构建](https://www.electron.build/v26/docs/features/multi-platform-build/)、[AppImage 配置](https://www.electron.build/v26/docs/appimage/)

CI 的基础层执行冻结锁文件安装、依赖边界检查、类型检查、Vitest 与组件测试，再编译全部入口。平台层构建真实安装包，验证 SQLite、preload、工作进程、取消、恢复和退出。原生依赖的 Node 测试环境与 Electron 环境分开管理，避免一次 rebuild 污染另一运行环境。

Playwright Electron 仍为实验性接口，并要求其启动过程能使用 inspector。可以使用保留该能力的测试构建做交互自动化。正式产物关闭 inspector 与 RunAsNode 等非必要能力，保留所需完整性保护，并以正式安全配置另做冒烟检查。签名和公证后的最终产物仍需验收。[Playwright Electron](https://playwright.dev/docs/api/class-electron)、[Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)

第一项实施验证应是一条完整的小链路。干净安装依赖后，构建本地 UI、preload 和工作入口，使用临时数据库与受控任务，生成三平台产物，离开源码目录启动，验证启停、持久化、退出和原生模块。通过这条链路后，再迁移业务代码和旧数据。

本轮使用三个并行研究分工覆盖 React 项目、Vue 项目和官方工具链，并完成综合分析。研究没有遇到阻塞。已验证的是源码、版本元数据和文档事实，没有执行性能基准、安装包或兼容性测试。推荐中的 UI 偏好、目标进程结构及迁移顺序属于设计判断。

Redesign from First Principles 让本轮重新比较打包器，而不是因为项目已使用 Forge 就继续沿用。Boundary Discipline 决定 renderer、preload、工作进程和存储的接口边界。Laziness Protocol 保留简单 SQL 迁移、按需求增加线程和 ORM，不复制大型产品的整套基础设施。
