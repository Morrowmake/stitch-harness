---
kind: upgrade-guide
description: "“自定义插件索引”组合包已移除：每个 Web profile 都有“发现”标签页，社区插件索引不再是默认值。"
---

# “自定义插件索引”组合包已移除

[English](guide.md) | 中文

## 变更

此前，在**实验性插件**下开启**自定义插件索引**会把 `@deepseek-ai/dsh-experimental-plugin-market-bundle` 追加到 profile 的 `package.json` 中的 `dsh.profile.bundles`。该组合包插入 `plugin-market` Host 行和 `ui-plugin-market`“发现”标签页行，`plugin-market` 行的默认 `indexes` 依次列出 Stitch 插件索引和 DeepSeek Harness 社区索引 `https://awesome-dsh-plugin.com/index.json`、`https://cdn.dsh.so/market/index.json`。

现在 `@deepseek-ai/dsh-web-app` 在每个 Web profile 中插入这两行，行 id 不变，因此插件页始终显示**已安装**和**发现**。模型的只读 `plugin_market` 工具默认关闭：只有开启可选组件**供智能体使用的插件市场工具**（`@deepseek-ai/dsh-component-plugin-market-tool`）时，Creator 预设才会提供它，因此除非你开启，会话不会多出工具声明。该组合包已删除：加载 profile 时会从 `dsh.profile.bundles` 中删除它并重写 `package.json`；其他 manifest 字段保持不变，插件页也不会为它显示缺失包条目。

默认 `indexes` 现在只有 Stitch 插件索引。社区索引列在**管理索引源…**的**社区索引**下，发现区把 Stitch 索引以外的每个索引标为**社区来源 — 未经 Stitch 审核**。

profile 已保存的索引列表（每次在发现区添加或移除索引源时，都会作为 `plugin-market` 覆盖项写入 profile 的 `cordis.patch.yml`）仍作用于同一行，并按原样保留，包括其中的社区索引。运行过该组合包但从未修改索引源的 profile 没有保存列表；它现在只显示 Stitch 索引。Stitch 不沿用旧的隐式默认值，因为社区索引未经 Stitch 审核，现在只在用户主动选择时添加。

## 迁移

1. 用每个受影响的 profile 启动一次 Stitch，无需手动编辑。由其他工具写入的 profile 目录需要自行从 `dsh.profile.bundles` 删除该条目。
2. 要再次浏览社区索引，打开**插件 → 发现 → 管理索引源…**，在**社区索引**下点击每个索引旁的**添加**。也可以在 profile 的 `cordis.patch.yml` 中保留或写入 `plugin-market` 行的 `indexes`；patch 层中针对 `plugin-market` 或 `ui-plugin-market` 的覆盖项照样匹配 Web 组合中的这两行。
3. 确认：`dsh.profile.bundles` 不再列出该组合包，**插件**无需实验性开关即显示**发现**标签页，**管理索引源…**列出你期望的索引源。
