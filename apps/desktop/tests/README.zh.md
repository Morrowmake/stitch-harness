# Desktop 本地验证

[English](README.md) | 中文

## 概述

本地壳弹窗和更新检查证据与生产后端联调、视觉验收、已安装应用升级分开记录。

## 目录

- [故障报告验证](#verification-diagnostics)
- [更新弹窗主题](#verification-theme)
- [原生浮层可见性](#verification-overlay)
- [验证证据](#verification-evidence)
- [待验证事项](#verification-open)

<a id="verification-diagnostics"></a>

## 故障报告验证

产品行为与限制见[故障恢复与诊断](../docs/diagnostics/README.zh.md)。

使用可丢弃的 profile、独立的 Electron `userData` 和实际打包客户端。构造最小本地组合包：`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，需要执行代码时再加入插件模块，然后打成可本地安装的 `.tgz`。这些包会故意使应用出错，不得发布或安装到日常 profile。

分别构造模块导入异常、插件初始化异常、`appReady` 后的异步异常，以及 Host 非零退出。用 patch 禁用 `agent`、`session`、`llm`、`tools` 提供者，检查服务缺失诊断。跨重启场景通过 `pluginManager` 选入该组合包，再重启同一 profile。运行期场景须实际观察客户端就绪；`appReady` 不代表窗口已经显示。

检查原始错误与 cause 或退出码、跨重启的操作 ID 和 Host 运行 ID、报告收集完成标记与遗漏信息、原生弹窗中的文件获取，以及禁用插件恢复后的启动。记录安装包版本和源码提交；生成测试包成功或管理操作返回成功，都不能代替客户端功能验证。测试后恢复协议关联并退出测试进程。

资源验证可构造大型稀疏历史文件、大量无关文件、密集记录，以及损坏行和未完成行。在独立新进程中测量，分开记录数据构造与收集开销，并核对实际读取量、输出大小、耗时和峰值内存。验证 Worker 取消时，可用仅测试加载的模块钩子在写入进入标记后挂起异步文件打开操作；先确认标记，再观察期限到达后的 Worker 退出，并逐字节核对基本报告。该方法不模拟内核系统调用卡死，也不代替打包客户端验证。
<a id="verification-theme"></a>

## 更新弹窗主题

执行 `pnpm --dir apps/desktop run build` 后，在 macOS 上运行真实 Electron 配色夹具：

```sh
apps/desktop/.desktop-build/targets/mac-arm64/electron/Electron.app/Contents/MacOS/Electron apps/desktop/tests/fixtures/update-theme.mjs
```

夹具创建独立 profile，加载生产壳 HTML、sandboxed preload、渲染脚本及打包的 design token，仅替换固定 IPC 状态响应。6 个用例覆盖普通更新文档的浅色／暗色初始状态、打开时切换及跟随系统。它检查文档背景透明、卡片／文字／按钮／遮罩配色、代码／地址表面、仅暗色显示的 1 CSS px 内描边及普通弹窗关闭图标，并将两张截图和 `result.json` 写入 `.desktop-build/qualification/update-theme-*`。它不启动 Host、不下载更新、不运行安装器，也不验证 Windows 原生渲染。首次关闭提示共用普通文档的 CSS 和主题脚本。

<a id="verification-overlay"></a>

## 原生浮层可见性

在 macOS 上，编译 Desktop Host 源码后复用缓存的 Electron 运行时：

```sh
pnpm exec tsc -b apps/desktop/tsconfig.host.json
apps/desktop/.desktop-build/targets/mac-arm64/electron/Electron.app/Contents/MacOS/Electron apps/desktop/tests/fixtures/update-overlay-visibility.mjs
```

夹具使用独立 profile，在 `.desktop-build/qualification/update-overlay-*` 下写入 `result.json`。它检查可见和隐藏的父窗口、不创建原生子窗口、父窗口可见性通知后独立对照窗口仍保留焦点，以及销毁父窗口时的视图和输入清理。它不使用网络、产品登录或 stitch Host。这项验证覆盖窗内承载方式，不覆盖完整的首次登录或安装流程。

<a id="verification-evidence"></a>

## 验证证据

打包监督夹具控制其 Git 元数据，使用真实文件哈希和无副作用的子进程。Git HEAD 与工作区变化仍会拒绝打包；并发测试无法改变夹具记录的 Git 输入。

| 层级 | 观察结果 |
|---|---|
| 更新检查 | 使用替身 fetch 的单元测试覆盖对发布列表的 semver 比较、草稿与预发布处理、项目发布页校验、仅在内置公钥时请求清单、清单被拒绝（签名不受信任或缺失、标签或版本不符、降级）时回退到手动下载、偏好门控（关闭时不自动请求）、启动与每日调度、开启时立即检查、自动检查失败静默，以及"立即检查"结果 |
| 更新清单 | 使用测试内生成的 ed25519 密钥对的单元测试覆盖规范 JSON、清单签名（轮换、键顺序、篡改、不受信任的公钥、无公钥）、内置公钥格式、平台附件选择，以及附件大小、SHA-256 和签名不符 |
| 一键安装 | 单元测试覆盖 macOS 和 Windows 安装计划构建（辅助脚本步骤、转义、安装程序参数）、暂存应用的标识符和版本检查、不可写及 App Translocation 的应用、无公钥或无已验证来源时不提供一键安装、下载进度，以及验证失败时不启动任何进程 |
| 主入口 | 主入口测试验证默认在启动时和每日检查、无内置公钥时回退到"下载/稍后"且只打开发布页面、关闭检查后停止自动请求并保存 `updates.checkForUpdates`，以及设置页和菜单分别报告有新版本、已是最新和检查失败 |
| 设置行 | 客户端测试覆盖开关、保存失败及每种"立即检查"结果；[浏览器场景](../../web/tests/desktop-update-check.e2e.ts)通过替身 Desktop 载体驱动构建后的设置界面，初始为开启状态 |
| 打包配置 | 元数据内置所配置的应用 ID，不含更新发布配置 |

<a id="verification-open"></a>

## 待验证事项

以下事项不是通过证据，评审时须保持可见：

- Electron `capturePage()` 只捕获单个窗口。跨平台 Figma／布局验收和完整录屏仍未验证。
- 没有测试访问真实 GitHub API；代理处理依赖 Electron 网络栈，未被自动化测试覆盖。
- Windows 上原生剪贴板写入通过。会尝试启动默认浏览器，但自动化工具无法可靠识别当前 URL，因此目标验证中止。macOS 浏览器与剪贴板集成仍未验证。
- 完整 `doc-sync` 在文档站测试中遇到 Windows 文件符号链接 `EPERM`，完整文档门禁未通过。
