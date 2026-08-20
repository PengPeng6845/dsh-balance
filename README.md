# dsh-usage-cost

Token 消耗与 API 成本报表插件（DeepSeek Harness 社区插件）。发布到 GitHub 的仓库根目录。

- packages/dsh-usage-cost/ — 插件本体（零依赖社区形态）
  - lib/index.js：插件主体（name / inject / apply），注册 token_usage 模型工具
  - lib/pricing.js：价格表 + 计价纯函数（内置 DeepSeek 官方价，配置合并覆盖）
  - lib/store.js：日/月累计增量聚合 → storage json 后端（usage_cost 单元），缺失降级内存
  - cordis.patch.yml：bundle 补丁层（insert 插件条目 + 配置示例注释）
  - test/smoke.mjs：零安装单元冒烟测试（npm test，CI 在 Node 20/22 运行）
  - LICENSE / SECURITY.md / CHANGELOG.md：开源发布三件套
- .github/workflows/ci.yml — GitHub Actions（push/PR 触发）
- .gitignore — 排除 node_modules / tarball / 本地测试目录 .dsh-test

## 本地验证记录

- npm test：21 项断言全过
- 隔离 DSH_HOME（.dsh-test，不在 git 里）：--dump-config 组合通过；web 实例 3099 端口启动正常；
  headless 实例真实调用 token_usage 返回 provider 上报用量与成本

## 发布到 GitHub（在仓库根目录执行）

    git remote add origin https://github.com/PengPeng6845/dsh-usage-cost.git
    git branch -M main
    git push -u origin main

## 发布到 npm

    cd packages/dsh-usage-cost
    npm login        # 首次需要
    npm publish

## 上架插件市场

到 awesome-dsh-plugin 仓库提 PR，把本仓库加进列表（见包内 README）。
