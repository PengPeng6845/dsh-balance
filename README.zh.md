# @pengpeng6845/dsh-balance

[![CI](https://img.shields.io/github/actions/workflow/status/PengPeng6845/dsh-balance/ci.yml?branch=main)](https://github.com/PengPeng6845/dsh-balance/actions)
[![license](https://img.shields.io/github/license/PengPeng6845/dsh-balance)](LICENSE)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的侧边栏加一个**真实 API 余额**显示：用你的 API key 轮询官方 /user/balance 端点，只显示真实数据，不做估算。

## 特性

- **侧边栏余额小组件**：侧边栏底部一行扁平原生样式「余额 ¥13.94」，每 30 秒刷新；悬停显示今日实际花费（余额差）与更新时间；侧边栏折叠时只显示金额。
- **API key 核实**：余额来自官方端点（真实账单数据）；余额下降即花费（充值上涨自动忽略），两次采样之间下降值 = 真实消费。
- **token_usage 工具**：附带保留——模型可自查 provider 上报的 token 分桶（精确）与真实余额；不含任何估算金额。
- **零依赖**：无 npm 运行时依赖、无构建步骤；Host 纯 ESM，Client 手写 bundle。

## 安装

npm（发布后）：

    dsh plugin --profile web add @pengpeng6845/dsh-balance

GitHub 直装：

    dsh plugin --profile web add github:PengPeng6845/dsh-balance

然后确认 profile 的 package.json 的 dsh.profile.bundles 里有 "@pengpeng6845/dsh-balance"（install 后手动追加即可），重启 dsh web。

## 配置

在 profile 自己的 cordis.patch.yml 中按 id 覆盖：

    - id: balance
      config:
        balanceEnabled: true
        balanceApiKeyEnv: DEEPSEEK_API_KEY
        balanceBaseUrl: https://api.deepseek.com
        balanceRefreshMs: 60000
        lowBalanceAlert: 5

| 键 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| balanceEnabled | boolean | true | 是否轮询官方余额端点 |
| balanceApiKeyEnv | string | DEEPSEEK_API_KEY | 余额 API key 的凭据引用（环境变量名） |
| balanceBaseUrl | string | https://api.deepseek.com | 余额 API 基地址 |
| balanceRefreshMs | number | 60000 | 兜底轮询间隔（毫秒）；token 活动后约 20 秒也会主动刷新 |
| lowBalanceAlert | number | 5 | 低于该余额时数字变橙（账户币种单位） |

余额以账户币种显示，不经过任何汇率换算。

## 开发

    npm test          # 零安装单元冒烟测试（node test/smoke.mjs）
    npm pack          # 生成可分发 tarball

CI 在 Node 20 / 22 上运行同一套测试，无需安装步骤。

## 上架插件市场

到 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR 加一条 [PengPeng6845/dsh-balance](https://github.com/PengPeng6845/dsh-balance) 条目即可。

## 许可

[MIT](LICENSE) © 2026 PengPeng6845
