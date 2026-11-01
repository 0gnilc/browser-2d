# Browser 2D

Browser 2D 是一个 Electron 桌面应用。界面管理设备、材料、历史、设置和任务，工作进程独占 SQLite，并通过 puppeteer-core 控制本机 Google Chrome。关闭桌面端时停止任务并清理自有资源。

当前浏览器任务只访问本地受控验证页面，不执行旧版付款流程，不接入 AdsPower。工程预览已覆盖 Windows、macOS Intel、macOS Apple Silicon 和 Linux。正式发布和已知问题见下方 Issue。

## 本地启动

使用 [.node-version](.node-version) 指定的 Node 版本和 [package.json](package.json) 指定的 pnpm 版本。浏览器任务需要本机安装 Google Chrome。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

开发数据位于 `artifacts/dev-data`。设置 `BROWSER2D_DATA_DIR` 可指定独立数据目录。打包应用未指定该变量时，业务数据库使用 `~/kys/data.db`。测试和试用包应指定临时目录，避免打开真实业务库。

## 文档

- [架构与技术选型](docs/architecture.md)说明三个应用、共享契约、工程配置及运行时边界。
- [开发与测试](docs/development.md)说明入口、热更新、测试范围和故障定位。
- [开发、测试与打包流程图](docs/workflows.md)说明开发重启、测试执行和打包发布的成功与失败路径。
- [发布工程](docs/release.md)说明预览包、签名、公证、安装验收及正式发布门槛。

精确依赖版本以 [workspace catalog](pnpm-workspace.yaml) 和 [锁文件](pnpm-lock.yaml) 为准。

## 未完成事项

进展和关闭条件只在 GitHub Issues 中维护。

- [#6 正式发布验收](https://github.com/0gnilc/browser-2d/issues/6)。
- [#8 Windows Chrome 获取超时](https://github.com/0gnilc/browser-2d/issues/8)。
