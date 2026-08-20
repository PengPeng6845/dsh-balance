<div align="center">

# 💰 dsh-balance

**DeepSeek Harness 侧边栏 · 真实 API 余额监控**

用你的 API key 直连官方账单端点 —— 只显示真实数据，不做任何估算。

[![CI](https://img.shields.io/github/actions/workflow/status/PengPeng6845/dsh-balance/ci.yml?branch=main&label=CI)](https://github.com/PengPeng6845/dsh-balance/actions)
[![version](https://img.shields.io/github/v/tag/PengPeng6845/dsh-balance?sort=semver&label=version)](https://github.com/PengPeng6845/dsh-balance/releases)
[![license](https://img.shields.io/github/license/PengPeng6845/dsh-balance)](LICENSE)
[![stars](https://img.shields.io/github/stars/PengPeng6845/dsh-balance?style=social)](https://github.com/PengPeng6845/dsh-balance)

</div>

> 💡 **一句话**：模型花掉多少钱，侧边栏里瞄一眼就知道 —— 余额来自官方 API，不是本地估算。

## ✨ 特性

<table>
<tr><th></th><th>特性</th><th>说明</th></tr>
<tr><td>💰</td><td><b>真实余额</b></td><td>官方 <code>GET /user/balance</code> 端点，API key 核实，按账户币种显示</td></tr>
<tr><td>⚡</td><td><b>准实时刷新</b></td><td>token 活动停止约 20 秒后主动追查 + 每分钟兜底轮询</td></tr>
<tr><td>🚨</td><td><b>低余额告警</b></td><td>低于阈值（默认 ¥5）数字变橙，悬停有提示</td></tr>
<tr><td>🌐</td><td><b>中英双语</b></td><td>文案跟随界面语言自动切换</td></tr>
<tr><td>🧹</td><td><b>零依赖</b></td><td>无 npm 运行时依赖、无构建步骤；Host 纯 ESM，Client 手写 bundle</td></tr>
</table>

## 🖥️ 界面

侧边栏底部，一行扁平原生风格（无卡片、无边框，hover 才高亮）——就一行，只有余额：

<pre>
┌──────────────────────────┐
│  余额            ¥22.39  │
└──────────────────────────┘
</pre>

- 余额低于警戒线 → 数字变 <b>橙色</b>（悬停提示警戒线）
- 数据过期（网络失败后退避期）→ 数字灰化，仍显示上次成功值
- 侧边栏折叠 → 只显示金额
- 标签页不可见 → 自动暂停轮询，省流量

## 📦 安装

npm（发布后推荐）：

<pre>dsh plugin --profile web add @pengpeng6845/dsh-balance</pre>

GitHub 直装：

<pre>dsh plugin --profile web add github:PengPeng6845/dsh-balance</pre>

然后确认 profile 的 <code>package.json</code> 的 <code>dsh.profile.bundles</code> 里有 <code>"@pengpeng6845/dsh-balance"</code>，重启 <code>dsh web</code>。

## ⚙️ 配置

在 profile 自己的 <code>cordis.patch.yml</code> 中按 id 覆盖：

<pre>
- id: balance
  config:
    balanceEnabled: true              # 是否轮询官方余额端点
    balanceApiKeyEnv: DEEPSEEK_API_KEY # 余额 API key 的凭据引用（环境变量名）
    balanceBaseUrl: https://api.deepseek.com
    balanceRefreshMs: 60000           # 兜底轮询间隔（毫秒）
    lowBalanceAlert: 5                # 低余额警戒线（账户币种单位）
</pre>

<table>
<tr><th>键</th><th>类型</th><th>默认</th><th>含义</th></tr>
<tr><td>balanceEnabled</td><td>boolean</td><td>true</td><td>是否轮询官方余额端点</td></tr>
<tr><td>balanceApiKeyEnv</td><td>string</td><td>DEEPSEEK_API_KEY</td><td>余额 API key 的凭据引用</td></tr>
<tr><td>balanceBaseUrl</td><td>string</td><td>https://api.deepseek.com</td><td>余额 API 基地址</td></tr>
<tr><td>balanceRefreshMs</td><td>number</td><td>60000</td><td>兜底轮询间隔；token 活动后约 20 秒也会主动刷新</td></tr>
<tr><td>lowBalanceAlert</td><td>number</td><td>5</td><td>低于该余额数字变橙</td></tr>
</table>

余额以账户币种显示，不做任何汇率换算。

## 🔄 工作原理

<pre>
                ┌───────────────┐
                │   你的 API key │ (凭据环境变量，每次请求重新解析，绝不落盘)
                └──────┬────────┘
                       │ Bearer
                       ▼
   ┌──────────────────────────────┐
   │  GET /user/balance (官方)     │  每 60s 兜底轮询
   │  · token 活动停止 20s 后追查   │  · 失败指数退避 5s→5m
   │  · 并发去重 / 10s 超时         │  · 退避期继续供上次成功值
   └──────────────┬───────────────┘
                  │
                  ▼
   ┌──────────────────────────────┐
   │  余额采样 → storage 持久化     │  余额下降差 = 真实花费
   │  (schemaVersion 3, 旧数据迁移) │  (充值上涨自动忽略)
   └──────┬───────────────┬───────┘
          │               │
          ▼               ▼
  侧边栏小组件        token_usage 工具
  (15s 拉取)         (模型自查 tokens+余额)
</pre>

## ❓ FAQ

<details>
<summary>为什么只显示余额，没有成本估算？</summary>
官方没有用量明细 API，本地估算随价格表漂移（历史上曾高估 70 倍）。本插件只信 <code>/user/balance</code> 的账单真值：余额下降就是花费。
</details>

<details>
<summary>多久更新一次？</summary>
模型回复结束约 20 秒后主动查一次（计费在回复后结算）；空闲时每分钟兜底；页面每 15 秒拉取最新值。流式输出过程中余额不动是正常的。
</details>

<details>
<summary>余额为 0 或显示"不可用"？</summary>
检查 <code>DEEPSEEK_API_KEY</code> 环境变量/凭据是否配置，以及网络是否可达。悬停小组件可看详细提示。
</details>

## 🗺️ 路线图

- [x] 侧边栏真实余额 + 准实时刷新
- [x] 今日实际花费（余额差）
- [x] 低余额告警 / 中英双语 / 一键发版
- [ ] SSE 即时推送（余额变化 <1s 上屏）
- [ ] 涨跌指示（▼¥0.08 每次消耗一目了然）
- [ ] 余额历史曲线
- [ ] 多 API key / 多账户

## 🧑‍💻 开发与发布

<pre>
npm test                        # 零安装单元冒烟测试（Node 20/22 CI）
npm pack                        # 生成可分发 tarball
npm run release -- 0.7.1 "..."  # 一键发版：bump+CHANGELOG+测试+tag+推送(+Release)
npm login && npm publish        # 发布到 npm
</pre>

## 🏪 上架插件市场

到 <a href="https://github.com/awesome-dsh-plugin/awesome-dsh-plugin">awesome-dsh-plugin</a> 提 PR 加一条本仓库条目，DSH 的「设置 → 插件市场」会自动收录（通常一天内生效）。

## 📄 许可

<a href="LICENSE">MIT</a> © 2026 <a href="https://github.com/PengPeng6845">PengPeng6845</a>

---

<div align="center">
<sub>Made for <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> · 感谢 <a href="https://github.com/dsh-market/dsh-market">dsh-market</a> 生态</sub>
</div>
