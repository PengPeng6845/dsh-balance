# dsh-usage-cost

[![npm](https://img.shields.io/npm/v/dsh-usage-cost)](https://www.npmjs.com/package/dsh-usage-cost)
[![CI](https://img.shields.io/github/actions/workflow/status/PengPeng6845/dsh-usage-cost/ci.yml?branch=main)](https://github.com/PengPeng6845/dsh-usage-cost/actions)
[![license](https://img.shields.io/github/license/PengPeng6845/dsh-usage-cost)](LICENSE)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 加"账单感"：把内置的 tokenUsage 会话投影乘上可配置的价格表，算出本次会话 / 今日 / 本月的花费，并给模型注册 token_usage 工具，随时自查、随时报账。

## 特性

- **token_usage 模型工具**：任务中途即可自查——返回 provider 上报的用量分桶（未缓存输入 / 输出 / 缓存读 / 缓存写）、本次会话成本，以及今日、本月累计。
- **真实计费数据**：优先读取 tokenUsage 投影（provider 上报，非估算）；token-meter 未挂载时退回其测量锚点；两者皆无则返回全零并注明。
- **日 / 月累计持久化**：增量写入 storage hub 的 json 后端（单元 usage_cost），后端缺失自动降级为进程内存；差值取非负入账，重试与回放天然幂等、不会重复计费。
- **按模型计价**：匹配顺序为 模型 id → provider 路由 → "*" 兜底，内置 DeepSeek 官方目录价，你的配置与内置表合并。
- **侧边栏成本小组件**：侧边栏底部实时显示「API 成本」卡片——今日/本月花费与 token 数，超阈值自动变橙/变红；聚合数据由投影变更流持续驱动，不调用工具也永远最新。
- **零依赖**：无任何 npm 运行时依赖、无构建步骤；Host 为纯 ESM，Client 为手写 bundle（name / inject / apply）。

## 安装

npm（推荐）：

    dsh plugin --profile web add dsh-usage-cost

然后在 profile 的 package.json 的 dsh.profile.bundles 末尾追加 "dsh-usage-cost"，重启 dsh web（HMR 生效的部署刷新页面即可）。

GitHub 直装（未发布 npm 时）：

    dsh plugin --profile web add github:PengPeng6845/dsh-usage-cost

上架插件市场后也可以在设置 → 插件市场里一键安装（见下文）。

## 配置

在 profile 自己的 cordis.patch.yml 中按 id 覆盖：

    - id: usage-cost
      config:
        currency: CNY          # 成本文案的货币符号：CNY / USD / EUR
        persist: true          # 是否持久化日/月累计
        prices:                # 与内置表合并，部分覆盖即可
          deepseek-chat:
            inputPerMillion: 2
            cacheReadPerMillion: 0.5
            cacheWritePerMillion: 2
            outputPerMillion: 8

| 键 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| currency | string | CNY | 成本文案的货币符号 |
| persist | boolean | true | 日/月累计是否写入 storage 的 json 后端 |
| prices | map | DeepSeek 官方目录价 | 每百万 token 单价，键为模型 id / provider 路由 / "*" |
| warnThreshold | number | 5 | 今日成本超过该值，小组件变橙 |
| alertThreshold | number | 20 | 今日成本超过该值，小组件变红 |

内置价格表（CNY / 1M tokens，会随时间调整，记得按官网更新）：

| 模型 | 输入(未命中) | 缓存读 | 缓存写 | 输出 |
| --- | --- | --- | --- | --- |
| deepseek-chat | 2 | 0.5 | 2 | 8 |
| deepseek-reasoner | 4 | 1 | 4 | 16 |

## 开发

    npm test          # 零安装单元冒烟测试（node test/smoke.mjs）
    npm pack          # 生成可分发 tarball

CI 在 Node 20 / 22 上运行同一套测试，无需安装步骤。

## 上架插件市场

dsh-market 的收录列表由 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 维护：往列表里加一条本仓库的条目提 PR 即可，网站与市场会自动收录（通常一天内生效）。

## 已知限制

- 聚合为单进程视角（storage-json 无跨进程锁）。
- 会话记忆上限 256 条（LRU 淘汰）。
- 成本基于配置价格表而非供应商账单，属估算值。

## 路线图

- Client 侧边栏小组件：实时显示今日/本月花费，超阈值变色（复用 useProjection("tokenUsage")）。
- 预算护栏：软上限提醒 + 硬上限挂起（tools/pre-execute 瀑布）。
- 按 goal / subagent 分账视图。

## 许可

[MIT](LICENSE) © 2026 PengPeng6845
