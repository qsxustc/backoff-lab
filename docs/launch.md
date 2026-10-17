# Launch notes

This document covers subsequent updates and provides editable announcement drafts. The public repository is [qsxustc/backoff-lab](https://github.com/qsxustc/backoff-lab), and the demo's permanent address is [qsxustc.github.io/backoff-lab](https://qsxustc.github.io/backoff-lab/). Check the [Pages deployment workflow](https://github.com/qsxustc/backoff-lab/actions/workflows/pages.yml) and open the demo to confirm the latest deployment before announcing an update.

## Positioning

**Name:** Backoff Lab  
**Tagline:** See every retry.  
**One sentence:** An interactive microscope for retry policies, with per-client timelines, reproducible scenarios, and a dependency-free browser and CLI engine.

The audience is backend engineers, SREs, distributed-systems learners, and people explaining retry behavior in a design review. The most useful demo is a small question answered in under a minute: “What changes when these synchronized clients add jitter?”

Retry visualizations and simulators already exist. Link the [related work in the README](../README.md#background-and-related-work), explain this project's scope, and emphasize the inspectable client histories and portable experiments. Avoid claims of being the first, promises of GitHub stars, or production performance claims derived from one synthetic run.

## Publish an update

1. Run `npm test` and `npm run build` from the repository root.
2. Run `npm run preview`, then check the default scenario, an imported scenario, a shared link, keyboard controls, and a narrow viewport.
3. Download CSV and HTML results and confirm they match the visible scenario. Check that the HTML report opens independently.
4. Review the English and Chinese READMEs, license, contribution guide, and model description.
5. Capture the actual app as `assets/demo.jpg`. Keep the screenshot's numbers consistent with its visible seed and parameters.
6. Review the staged files and ensure only this project is included. Do not include local reports, credentials, unrelated workspace content, or build artifacts.
7. Push reviewed commits to `main` in [qsxustc/backoff-lab](https://github.com/qsxustc/backoff-lab). The [CI workflow](https://github.com/qsxustc/backoff-lab/actions/workflows/ci.yml) checks Node.js 20, 22, and 24.
8. A push to `main` automatically starts the [Pages workflow](https://github.com/qsxustc/backoff-lab/actions/workflows/pages.yml), which runs tests, builds `dist/`, and deploys it. Pages uses GitHub Actions as its source. The workflow also supports a manual run for redeployment.
9. Wait for the deployment to succeed, then verify the [online demo](https://qsxustc.github.io/backoff-lab/), including a copied experiment link. A successful build alone does not confirm that the hosted app works.
10. For a versioned release, create a tag and GitHub release describing the implemented features, model boundaries, and reproducible example. Confirm any package name's availability before considering npm publication.

The local CLI works with `node bin/backoff-lab.js`; it does not require npm publication. Keep the repository description aligned with the one-sentence pitch and its Website field set to the demo address. Suggested topics: `backoff`, `retry`, `jitter`, `distributed-systems`, `simulation`, `visualization`, `sre`, `javascript`.

## A short demo recording

Aim for 20–35 seconds, with legible labels:

1. Show the Recovery burst preset and the Exponential versus Full jitter pressure charts.
2. Select one client and inspect its failure/wait/success sequence.
3. Turn on Retry-After and show how a shared minimum wait changes the timing.
4. Copy the experiment link or download the report.

Include the seed and scenario parameters in the accompanying text. Use “in this scenario” when describing a result. Do not hide exhausted or deadline-expired clients to make a policy appear faster.

## English announcement draft

**Title:** Show HN: Backoff Lab — see every retry in a thundering herd

I built Backoff Lab to make retry behavior easier to inspect. Give a recovering service a burst of clients, compare fixed delay, exponential backoff, and three jitter strategies, then click a client to see its actual attempt history.

It runs locally in the browser and shares a deterministic engine with a Node.js CLI. Scenarios have seeds and can be exported as JSON or shared in a URL; results can be downloaded as attempt CSV or a standalone HTML report. There are no runtime dependencies or API keys.

The model is deliberately small: a finite burst, concurrent server slots, fixed response times, and a deadline per client. The UI shows successful-client p95 alongside completion counts, because a policy that abandons clients can otherwise look deceptively fast.

I'd appreciate feedback on which retry interactions are hardest to explain, and whether the client timeline makes them easier to see.

[Try the demo](https://qsxustc.github.io/backoff-lab/) · [Source on GitHub](https://github.com/qsxustc/backoff-lab)

This is an editable draft; nothing has been posted automatically. Verify the current deployment before posting.

## 中文宣传草稿

**标题：** 做了一个重试策略显微镜：把惊群效应和 Jitter 画成可检查的时间线

Backoff Lab 可以让一批客户端同时访问正在恢复的服务，对比固定延迟、指数退避和三种 Jitter。除了看整体请求压力，还能点选一个客户端，逐次查看它什么时候请求、为什么失败、等了多久、最后有没有成功。

浏览器应用与 Node.js CLI 共用一个带随机种子的确定性引擎。支持 JSON 场景导入导出、URL 分享、逐次请求 CSV 和独立 HTML 报告；无需 API Key，没有运行时依赖。

模型明确限定为有限的一批请求、服务器并发槽位和固定响应延迟。p95 只统计成功客户端，因此会和完成数量一起展示，方便讨论不同策略的取舍。

欢迎分享你在排查重试问题时遇到的难点，或提供一个值得放进示例库的场景。

[在线体验](https://qsxustc.github.io/backoff-lab/) · [GitHub 源码](https://github.com/qsxustc/backoff-lab)

这是可编辑草稿，尚未对外发送。对外发布前请确认当前部署已成功且 Demo 可访问。

## After release

Use feedback to improve the next experiment: collect confusing labels, reproducible bug reports, missing explanations, and concrete teaching or debugging use cases. Useful follow-up work may include seed sweeps and variability displays, more accessible timeline inspection, or additional documented scenarios. Treat community interest as feedback; do not promise a star count or replace product work with unsolicited promotional messages.
