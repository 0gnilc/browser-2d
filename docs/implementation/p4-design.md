# P4 本机 Chrome 适配

用户在实施过程中明确取消 AdsPower，改为直接使用 Google Chrome。本阶段接入 puppeteer-core，验证本地受控页面。暂不推进 P5，也不恢复旧付款、订阅及无限重试逻辑。跟踪事项为 [Issue #5](https://github.com/0gnilc/browser-2d/issues/5)。

设置改为 Chrome 启动模式或借用模式。启动模式使用指定可执行文件，留空则查找系统安装的 Chrome。每次运行创建应用专属用户目录，不使用用户默认浏览器目录。借用模式只接受显式配置的本机 HTTP 调试地址。窗口大小、页面数和设置版本继续保留。任务接纳事务固定浏览器配置，之后修改设置不会改变旧任务的清理目标。

调度继续限制两台设备和四个页面单位。私有 SQLite 台账记录浏览器启动意图、浏览器实例身份及隔离上下文。所有创建操作先记录意图，再执行外部操作。旧 P3 资源仍使用显式受控文件驱动恢复，不解释为 Chrome 资源。

自有 Chrome 使用 Puppeteer 的默认参数和显式子进程启动。启动参数包含独立用户目录和随机所有者标记。恢复通过该目录的 DevToolsActivePort 找到浏览器，再在同一 CDP 连接上校验启动标记、目录及浏览器实例。关闭仅作用于核验后的实例。持久化 PID 不提供杀进程权限。清理必须观察进程退出，不能把调试连接断开当作浏览器退出。

借用会话为每个任务创建 disposeOnDetach 隔离上下文。先保存上下文 ID，再创建页面。第二条 Puppeteer 连接只访问这个上下文。清理关闭任务上下文并核对其不存在，保留原有浏览器和标签页。未知启动结果、丢失的上下文创建结果或无法核对的浏览器实例保持未清理状态并继续占用容量。

服务调用 acquire、execute 和 cleanup。只有 cleanup 明确返回已清理，服务才释放资源。此规则替换 P3 中借用资源仍存在即可释放的判断。

活动设置移除 AdsPower 地址、API Key 和凭据状态。旧数据库行、加密凭据文件和历史迁移保留用于兼容，不参与 Chrome 执行。已迁移数据库中的停用凭据不再阻止正常启动。004 迁移只新增 Chrome 私有记录，不修改 001 至 003。

设计比较了 Puppeteer.launch 和显式 spawn。选择后者是为了在连接浏览器之前持有可观察的子进程句柄，并非认为它消除了启动崩溃窗口。参数仍由 Puppeteer.defaultArgs 生成。综合采用候选 A 的启动状态和退出证据、候选 B 的进程监督、候选 C 的旧设置迁移边界。独立评审要求保留所有不确定状态。

验证分别覆盖真实 Chrome 页面与进程、调度与 SQLite、Electron worker 崩溃和关闭、生产依赖与原生打包。自动化测试只使用临时目录和本地页面。旧业务流程没有执行，浏览器安装包也不随 Electron 应用重复分发。

参考 [Puppeteer 启动选项](https://pptr.dev/api/puppeteer.launchoptions)、[隔离上下文](https://pptr.dev/api/puppeteer.browser.createbrowsercontext)及 [CDP Target 协议](https://chromedevtools.github.io/devtools-protocol/tot/Target/)。

Windows 上的自有 Chrome 使用 detached 启动，保留当前 ChildProcess 句柄进行正常关闭。这样 worker 意外退出时，Chrome 不会被 Node 的父进程终止作业提前杀掉，新的 worker 可以核验浏览器身份后完成清理。测试在 worker 死亡后、启动恢复进程前检查 Chrome 仍存活。此差异依据 [Node/libuv 的 Windows 子进程实现](https://github.com/nodejs/node/blob/v24.5.0/deps/uv/src/win/process.c#L1016-L1035)，不改变从磁盘 PID 不得授予终止权限的规则。
