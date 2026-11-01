# 构建与验收发布候选

候选生成、最终文件验收、暂存和上传是不同操作。当前工程只支持前三步，`pnpm release` 明确拒绝未配置的线上发布。待完成的正式分发条件由 [Issue #6](https://github.com/0gnilc/browser-2d/issues/6)维护。

## 生成预览包

在目标平台及架构的原生主机上执行。目标与交付格式以 [release.mjs](../internal/build-config/release.mjs) 的 `targets` 为准。

```sh
pnpm dist -- --target=mac-x64
```

默认生成未签名预览包，输出到 `release/<target>`。只需可运行应用目录时使用 `pnpm package`。预览不启用更新，不能通过正式发布验收。

打包在临时源码副本中锁定安装并构建，不复用开发构建输出。执行会清理所选目标的旧输出。保留需要复查的安装包时，先将整套产物和清单移到独立目录。

在隔离验收主机上检查预览产物。

```sh
pnpm verify:package -- --target=mac-x64
pnpm verify:installation
pnpm verify:formats -- --target=mac-x64
```

`verify:package` 在仓库外运行复制的应用。`verify:installation` 实际安装、同版本重装和卸载，Windows/Linux 只在一次性 CI 环境运行。`verify:formats` 在 macOS 运行实际 ZIP，在 Linux 运行 FUSE AppImage，并要求当前干净提交生成的预览产物。Windows 不运行此格式命令。

同版本重装不能证明 N 到 N+1 升级。开发与测试使用独立数据目录，具体路径规则见[架构文档](architecture.md#数据与安全边界)。

## 生成生产候选

先准备干净源码、频道、可信 HTTPS 更新源及对应平台签名输入。必需变量和校验规则由 [validateProductionInputs](../internal/build-config/release.mjs)维护，GitHub secret 到变量的映射只维护在[候选工作流](../.github/workflows/release.yml)。缺少条件时拒绝构建，不回退为预览模式。

```sh
pnpm dist -- --mode=production --target=mac-x64 --channel=test --feed-base-url=https://updates.example.invalid/browser-2d
```

替换示例域名后执行。输出位于 `release/production/<channel>/<target>`。生产模式必须使用 `dist`，不能仅生成应用目录。频道和 feed 写入包内配置，运行时环境变量不选择更新服务器。

macOS 在最终 DMG 公证和 stapling 完成后计算清单，保留 `notarization.json`。`build-context.json` 记录源码、工具和配置，`artifact-inventory.json` 记录最终文件摘要。这些文件证明来源和完整性，不证明安装或升级行为已验收。

## 验证同一批最终文件

先在目标原生系统执行安装、真实升级、受控 feed 故障、数据保留、卸载、退出清理及仓库外运行。将实际命令、日志和观察值保存为 `release-acceptance.json` 及其引用文件。

报告结构、必需场景、摘要绑定及旧 Squirrel 证据要求以 [release-verify.mjs](../scripts/release-verify.mjs) 为准，[发布工具测试](../scripts/release.test.mjs)包含构造示例。测试 fixture 仅用于说明结构，不能作为实际验收证据。预览报告也不能改名充当生产证据。

```sh
pnpm release:verify -- --directory=/absolute/path/release/production/test/mac-x64 --evidence=/absolute/path/native-mac-x64-evidence
```

验证器检查现有文件，不构建、签名、安装或上传。成功时写入原生检查记录和 `release-receipt.json`，失败会移除旧回执。回执绑定精确的产物与证据摘要，是本地验证记录，不是独立签名机构的证明。

## 暂存四目标候选

```sh
pnpm release:prepare -- --directory=/absolute/path/release/production/test --staging=/absolute/path/new-empty-staging
```

准备四目标回执后执行，暂存目录必须是新的空目录。脚本复核来源一致性、产物和证据，复制前后再次核对摘要，不重新构建或签名。`upload-manifest.json` 区分安装文件、最后上传的更新元数据及不应进入公开 feed 的来源记录。暂存完成不代表已发布。

## 在 GitHub Actions 中运行

[CI](../.github/workflows/ci.yml)负责原生测试及预览安装验收。[候选工作流](../.github/workflows/release.yml)仅手动触发，生成并归档候选，不生成正式回执、不发布 Release、不上传更新源。

两者使用[共享依赖安装](../.github/actions/setup-dependencies/action.yml)，版本读取仓库清单，只缓存 pnpm store。候选的生产预检先于依赖安装，签名输入只提供给对应平台的预检和打包步骤。查看 Actions 中每个目标的日志和 artifact，不能用单一平台成功替代四目标完成。
