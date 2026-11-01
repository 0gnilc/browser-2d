# 开发、测试与打包流程

技术依赖见[技术选型图](architecture.md#技术选型图)。以下 Mermaid 图按当前脚本描述开发、测试和打包流程，不替代应用测试、安装验收或正式发布证明。

## 开发流程

对应 [scripts/dev.mjs](../scripts/dev.mjs) 的 `pnpm dev` 和 `pnpm dev:worker`。先构建 worker，再构建 desktop。构建及配置加载成功后才停止旧应用。停止失败时不启动替代进程。

```mermaid
---
title: "开发协调器 pnpm dev / dev:worker"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: 完成
    lg1: 失败
    lg2: 开发
  }
  class lg0 teal
  class lg1 orange
  class lg2 blue
  s0: 构建中#65292;尚无应用
  s1: 关闭监听并停止应用
  s2: 准备 UI 服务并启动应用
  s3: 构建失败#65292;等待下次变更
  s4: 关闭失败#65292;以错误退出
  s5: 已退出
  s6: 应用运行#65292;监听源码变更
  s7: 构建中#65292;旧应用继续运行
  s8: 构建成功#65292;停止旧应用
  s9: 构建失败#65292;旧应用仍在运行
  s10: 停止失败#65292;未启动替代应用
  [*] --> s0
  s0 --> s1: 收到退出信号或检查模式 stop
  s0 --> s2: 构建成功
  s0 --> s3: 构建失败并记录错误
  s1 --> s4: 停止或清理失败
  s1 --> s5: 应用及服务清理成功
  s2 --> s1: 收到退出信号或检查模式 stop
  s2 --> s6: 启动 Electron
  s3 --> s0: 处理源码变更并重新构建
  s3 --> s1: 收到退出信号或检查模式 stop
  s6 --> s1: 收到退出信号或检查模式 stop
  s6 --> s7: 处理源码变更并重新构建
  s7 --> s1: 收到退出信号或检查模式 stop
  s7 --> s8: 构建成功
  s7 --> s9: 构建失败并记录错误
  s8 --> s1: 收到退出信号或检查模式 stop
  s8 --> s10: 旧应用停止失败或超时
  s8 --> s2: 旧应用正常退出
  s9 --> s7: 处理源码变更并重新构建
  s9 --> s1: 收到退出信号或检查模式 stop
  s10 --> s0: 处理源码变更并重新构建
  s10 --> s1: 收到退出信号或检查模式 stop
  s10 --> s7: 处理源码变更并重新构建
  class s0 blue
  class s1 blue
  class s2 blue
  class s3 orange
  class s4 orange
  class s5 teal
  class s6 blue
  class s7 blue
  class s8 blue
  class s9 orange
  class s10 orange
```

Vue 模板和样式的 HMR 保持原 worker，不经过整应用重启。`dev:worker` 不创建 UI 服务，`dev:ui` 是独立的浏览器预览入口。首次启动前先完成依赖安装，三个入口的操作步骤见[开发指南](development.md)。

图省略重复文件事件和防抖等内部步骤，保留构建、重启与退出的主要失败分支。具体异常和并发处理以开发脚本为准。

## 测试流程

对应根 [package.json](../package.json) 的 `pnpm verify`，各组命令按顺序运行。任一命令失败即停止，不执行后续命令。

```mermaid
---
title: "本地 pnpm verify 串行且失败即停止"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: 通过
    lg1: 失败
    lg2: 验证
  }
  class lg0 teal
  class lg1 orange
  class lg2 blue
  s0: 静态及工作流检查
  s1: 验证失败#65292;后续套件不执行
  s2: 单元测试 test
  s3: 原生存储 test:storage
  s4: 凭据 test:credentials
  s5: 更新 test:updates
  s6: 发布规则 test:release
  s7: 浏览器观察 test:observer
  s8: Electron 集成与 UI test:electron
  s9: 本地验证全部通过
  [*] --> s0
  s0 --> s1: 失败#65292;命令短路退出
  s0 --> s2: 通过#65292;执行下一项
  s2 --> s1: 失败#65292;命令短路退出
  s2 --> s3: 通过#65292;执行下一项
  s3 --> s1: 失败#65292;命令短路退出
  s3 --> s4: 通过#65292;执行下一项
  s4 --> s1: 失败#65292;命令短路退出
  s4 --> s5: 通过#65292;执行下一项
  s5 --> s1: 失败#65292;命令短路退出
  s5 --> s6: 通过#65292;执行下一项
  s6 --> s1: 失败#65292;命令短路退出
  s6 --> s7: 通过#65292;执行下一项
  s7 --> s1: 失败#65292;命令短路退出
  s7 --> s8: 通过#65292;执行下一项
  s8 --> s9: 通过#65292;执行下一项
  s8 --> s1: 失败#65292;命令短路退出
  class s0 blue
  class s1 orange
  class s2 blue
  class s3 blue
  class s4 blue
  class s5 blue
  class s6 blue
  class s7 blue
  class s8 blue
  class s9 teal
```

`check` 包含格式、lint、类型和边界检查。`test:electron` 先构建再运行真实 Electron 测试。图将每组命令作为一次成功或失败结果，不表达测试覆盖率及内部断言。

[CI 工作流](../.github/workflows/ci.yml)保留完整原生矩阵，另验收安装包和实际交付格式。`Native acceptance` 只有在整个矩阵成功时通过。PR、main push 和手动运行均使用相同范围，独立分支 push 不重复触发。文档改动也运行完整 CI，避免跳过整个工作流后缺少检查结果。具体步骤及 runner 只维护在 YAML 中。

## 打包与发布校验流程

对应 [package.mjs](../scripts/package.mjs)、[release-verify.mjs](../scripts/release-verify.mjs) 和 [release-prepare.mjs](../scripts/release-prepare.mjs)。图覆盖 `dist` 到发布准备的路径。`package` 仅生成可运行目录，不满足正式候选要求。

```mermaid
---
title: "打包与发布准备 preview / production"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: 暂存
    lg1: 失败
    lg2: 核验
    lg3: 候选
  }
  class lg0 teal
  class lg1 orange
  class lg2 purple
  class lg3 blue
  s0: 原生目标与模式输入预检
  s1: 建立隔离源码副本
  s2: 输入被拒绝
  s3: 锁定依赖并构建
  s4: 操作失败#65292;未完成发布准备
  s5: 生成候选安装包及清单
  s6: 生产候选#65292;尚未验收
  s7: 预览产物#65292;仅供验证
  s8: 核验生产候选及外部证据
  s9: 单目标精确产物回执
  s10: 四目标回执齐备#65292;复核并暂存
  s11: 本地暂存完成#65292;尚未上传
  [*] --> s0
  s0 --> s1: 原生平台与模式要求满足
  s0 --> s2: 目标或生产输入不满足
  s1 --> s3: 隔离完成并配置对应模式环境
  s1 --> s4: 复制#12289;安装#12289;构建或打包失败
  s3 --> s4: 复制#12289;安装#12289;构建或打包失败
  s3 --> s5: 安装并构建成功
  s5 --> s4: 复制#12289;安装#12289;构建或打包失败
  s5 --> s7: 预览包及构建清单就绪
  s5 --> s6: 生产最终安装包及元数据就绪
  s6 --> s8: 提供外部原生验收并运行 release:verify
  s8 --> s4: 证据缺失#12289;检查失败或文件变化
  s8 --> s9: 元数据#12289;验收#12289;原生检查及复查全通过
  s9 --> s10: 收齐四目标且提交#12289;锁#12289;版本及频道一致
  s10 --> s4: 回执#12289;目录#12289;文件或证据复查失败
  s10 --> s11: 逐文件复核复制并生成上传清单
  class s0 blue
  class s1 blue
  class s2 orange
  class s3 blue
  class s4 orange
  class s5 blue
  class s6 blue
  class s7 blue
  class s8 purple
  class s9 purple
  class s10 purple
  class s11 teal
```

图中的候选生成、原生验收和四目标暂存是不同操作。预览包不能获得正式验收回执，当前发布命令不上传文件。操作步骤见[发布工程](release.md)。
