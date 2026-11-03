# 开发与测试

## 启动本地应用

首次安装和启动见 [README](../README.md#本地启动)。以下命令均在仓库根目录执行。

| 入口                       | 行为                                              |
| -------------------------- | ------------------------------------------------- |
| `pnpm dev`                 | UI、Electron main/preload 和 worker 一起启动      |
| `pnpm dev:ui`              | 仅浏览器预览，显示预览提示，业务及任务不可用      |
| `pnpm dev:backend`         | 同一 Electron 工作宿主，无窗口，不是独立后台服务  |
| `pnpm dev -- --inspect-ui` | 启用 loopback renderer 调试，输入 `stop` 协调退出 |

VS Code 的桌面调试配置使用 `--inspect-ui`。关闭桌面窗口会取消工作、清理自有浏览器资源并退出 worker。

## 修改源文件

Vue 模板及样式使用 Vite HMR，保留原 worker。main、preload、worker、contracts、SQL 迁移、应用构建配置及共享 TypeScript 预设的修改触发协调重启。

协调器先构建并加载新 renderer 预设，再停止旧应用、重建 Vite 服务并启动替代进程。构建或预设加载失败时保留旧应用；关闭失败时禁止启动替代进程。详细状态及失败分支见[开发流程图](workflows.md#开发流程)。

修改依赖清单、锁文件、pnpm 配置或 Node 版本后，停止开发进程，重新安装依赖，再启动应用。开发协调器不会自动替换运行中的依赖。

## 验证变更

运行完整本地检查。

```sh
pnpm verify
```

`verify` 的具体组成和顺序只在根 [package.json](../package.json) 中维护，任一命令失败即停止。可单独运行对应的 `test:*` 命令定位失败。组件、工作模块和桌面集成用例分别位于 [UI 测试](../apps/ui/tests)、[worker 测试](../apps/backend/tests)和 [Electron 测试](../tests/e2e)。

`pnpm test:e2e` 与 `pnpm test:electron` 使用同一入口。`pnpm build` 可单独验证 worker → desktop → 产物检查的构建链。完整 `verify` 已在 Electron 测试前构建，不包含安装器及正式发布验收。

工作模块测试按文件串行执行，单个调度用例仍覆盖并发设备。数据库、浏览器用户目录和页面使用隔离测试资源。`BROWSER2D_CHROME_EXECUTABLE` 可指定测试 Chrome 可执行文件，与应用 Settings 中的运行设置分开。

Electron 开发测试会临时修改源码并在 `finally` 中还原。运行该套件前关闭开发 watcher，测试期间不要同时编辑这些文件。Playwright 报告和 trace 写入 `artifacts/`。

Linux 的 Electron 集成需要图形会话及可用的 secret service。CI 使用一次性 D-Bus、GNOME keyring 和 Xvfb。

```sh
dbus-run-session -- xvfb-run -a bash scripts/testing/linux-secret-session.sh pnpm test:electron
```

该脚本用于隔离测试会话，不替换桌面 keyring。测试流程与 CI 的区别见[测试流程图](workflows.md#测试流程)。

## 验证独立任务和 AdsPower

运行 `pnpm test:process` 验证选中任务的外部停止、真实进程退出、SQLite 存活和正式 BrowserWorker 入口。结果写入 `artifacts/process/`。成品验收自动从 ASAR 重跑同一组检查。这里的受控平台结果不代表实际 AdsPower 验收。

真实平台验证只使用两个专用、关闭的测试环境。macOS 开发凭据保存在 Keychain 的 `io.github.0gnilc.browser2d.development.adspower` 服务及 `browser-2d-development` 账户。Main 读取凭据，子进程不继承 Main 环境，命令和报告不包含密钥或浏览器连接地址。

```sh
pnpm test:adspower -- --profile-a=DEDICATED_A --profile-b=DEDICATED_B
```

命令逐个检查环境为 Inactive，再启动并打开百度。停止第一个任务时，另一个页面继续响应，DataService 继续提交。最后只关闭本次启动的专用环境，不删除环境，不访问卡。已打开的环境被拒绝接管。未确认的启动或关闭在报告中保留为 BLOCKED。

使用 `--executable=/absolute/path/to/packaged-executable` 验证已构建成品，执行目录位于源码仓库之外。报告位于 `artifacts/adspower/report.json`，包含正式入口路径、导航确认、另一任务的心跳、数据库提交和关闭证据。真实平台验证单独执行，不在公共 CI 中读取开发凭据。

## 定位运行失败

任务命令返回不确定结果时，保留原 commandId 并查询原命令。设置保存冲突时，重新加载后比较修改。资源占用、恢复和退出规则见[调度与资源归属](architecture.md#调度与资源归属)。

不要通过手工删除进程所有权记录绕过接管保护。

## 管理本地产物

`apps/desktop/dist` 和 `apps/backend/dist` 是当前构建输出。停止开发进程后可以删除，再由 `pnpm build` 重建。`artifacts/` 混合保存开发数据库、日志和测试结果，不能把整个目录视为缓存。

`release/` 保存已有安装包及产物清单。需要复核或分发的包应保留对应哈希和来源记录。`.audit/` 已被 Git 忽略，临时调查记录不再作为当前项目文档维护。

安装包构建及验收使用[发布工程](release.md)中的命令。不要用本地测试通过代替最终产物的原生验收。

## Standalone UI workspace

`pnpm --filter @browser-2d/ui dev`, `build`, `preview`, `test` and `typecheck` use the UI workspace configs and shared renderer preset. Standalone mode reports unavailable desktop capabilities. `pnpm build` builds backend and desktop, including the renderer once. `pnpm dev:backend` starts the legacy DataService without a window. Browser/Card DTOs are foundation contracts; current routes retain their legacy handlers until later stages.
