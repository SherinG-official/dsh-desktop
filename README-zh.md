# dsh-desktop-pet

DeepSeek Harness 的桌面桌宠：一个置顶浮窗，工作时实时显示 token 用量与账户余额。

[English](README.md) · [Español](README-es.md) · [हिन्दी](README-hi.md) · [Português](README-pt.md)

## Compatibility

| 面向 | 状态 |
|---|---|
| Harness | DeepSeek Harness `0.2.0-rc.2`（desktop profile） |
| Node | `^22.19.0 || >=24.0.0` |
| 平台 | Windows（浮窗宿主是 Electron） |

## What it does

以 Host 插件的形式**掌管浮窗进程的生命周期**。

插件接口本身开不出浮窗：Client 模块（`dsh.client`）跑在 harness 页面里，Host 插件跑在 Node 里、拿不到 Electron 的窗口 API。所以浮窗仍然是独立进程，而这个插件负责管理它——激活时拉起、卸载时终止、崩溃后重启。

浮窗自己读数据，不向 harness 要任何东西：

| 显示 | 来源 |
|---|---|
| token 用量 | 引擎自己记录的 `tokenUsage` 投影行，位于 `<DSH 主目录>/storages/session_projcache/sessions/*.json` |
| 账户余额 | 官方 `GET https://api.deepseek.com/user/balance`，密钥取自 `~/.dsh/.credentials.yaml`，只在浮窗进程内使用 |

因为注册走的是单个 `ctx.effect()`，**在 harness 里关掉插件就等于关掉桌宠**，热重载也不会留下孤儿进程。

## Install

```sh
pnpm pack
dsh plugin --profile desktop add ./dsh-desktop-pet-0.1.0.tgz
```

⚠️ 用**目录路径**安装不会注册 bundle——必须是 tarball（或 npm / git 源）。装完要重启桌面端，bundle 插件在启动时加载。

浮窗宿主是 `electron`，作为普通依赖安装。pnpm 的构建脚本审批门必须放行它——harness 会把这个决定留在 profile 的 `pnpm-workspace.yaml` 里：

```yaml
allowBuilds:
  electron: true
```

## Configuration

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `enabled` | boolean | `true` | 插件激活时是否拉起浮窗 |
| `command` | string | `''` | 承载浮窗的可执行文件。留空则通过模块系统解析 `electron`，因此 hoisted 与嵌套链接都能用 |
| `args` | string[] | `[]` | 传给 `command` 的参数。留空则运行随包分发的浮窗入口 |
| `cwd` | string | `''` | 浮窗进程的工作目录。留空用 `<插件>/workspace`——**刻意不取用户主目录**，那里的 `NTUSER.DAT` 锁会让文件监视器挂掉 |
| `restartDelayMs` | number | `2000` | 异常退出后重新拉起的延迟。`0` 表示不再重启 |
| `maxRestarts` | number | `5` | 连续重启次数上限，超过后停止并记录一次错误 |

配置由 `lib/index.js` 的 Schemastery `Config` schema 校验；没有硬编码的可调项。非法值在加载期响亮失败，而不是静默取默认值。

正常退出（`code 0`）被视为用户主动关闭桌宠，**永不重启**；只有异常退出才计入 `maxRestarts`。

## Development

```sh
npm install --ignore-scripts   # 迭代时跳过 electron 二进制的大下载
npm test
```

`tests/lifecycle.test.js` 用桩上下文驱动真实插件：断言 effect 被注册（disabled 时不注册）、激活会拉起子进程而 dispose 会杀掉它、崩溃会重启而正常退出不会、运行时缺失会被记录而不是吞掉。

## License

[Apache License 2.0](LICENSE) © 2026 dsh-desktop-pet contributors.
