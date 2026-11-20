# native/

[English](README.md) | 中文

与 Stitch 一同维护的原生源码和包。[`system/` workspace](system/README.zh.md) 负责 Landlock 启动器、POSIX flock 绑定及其平台包。

## Workspace 与发布边界

`system/` 及其包属于仓库根 pnpm workspace，并共用根锁文件。开发和 CI 中的 harness 消费方直接使用当前 workspace 的入口包，因此启动器约定变更与消费方更新可以在同一个改动中落地并一起测试。

主仓库的 `Node Addon System` 工作流在 Node 24 上为每个受支持架构构建并测试。Stitch 不向 npm 发布这些包；桌面版构建从 workspace 打包它们。入口包继续将平台包声明为可选依赖，因此安装时只会获得与用户操作系统和 CPU 匹配的包。
