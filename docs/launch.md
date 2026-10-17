# Launch notes

This document is a release checklist and a set of editable announcement drafts. It does not imply that a GitHub repository, package, release, or hosted demo has already been published.

## Positioning

**Name:** Backoff Lab  
**Tagline:** See every retry.  
**One sentence:** An interactive microscope for retry policies, with per-client timelines, reproducible scenarios, and a dependency-free browser and CLI engine.

The audience is backend engineers, SREs, distributed-systems learners, and people explaining retry behavior in a design review. The most useful demo is a small question answered in under a minute: “What changes when these synchronized clients add jitter?”

Retry visualizations and simulators already exist. Link the [related work in the README](../README.md#background-and-related-work), explain this project's scope, and emphasize the inspectable client histories and portable experiments. Avoid claims of being the first, promises of GitHub stars, or production performance claims derived from one synthetic run.

## Prepare a release

1. Run `npm test` and `npm run build` from the repository root.
2. Run `npm run preview`, then check the default scenario, an imported scenario, a shared link, keyboard controls, and a narrow viewport.
3. Download CSV and HTML results and confirm they match the visible scenario. Check that the HTML report opens independently.
4. Review the English and Chinese READMEs, license, contribution guide, and model description.
5. Capture the actual app as `assets/demo.jpg`. Keep the screenshot's numbers consistent with its visible seed and parameters.
6. Review the staged files and ensure only this project is included. Do not include local reports, credentials, unrelated workspace content, or build artifacts.
7. Create a public GitHub repository under the intended owner, add its real URL as the Git remote, and push the reviewed commits.
8. Set the description to the one-sentence pitch. Suggested topics: `backoff`, `retry`, `jitter`, `distributed-systems`, `simulation`, `visualization`, `sre`, `javascript`.
9. Publish `dist/` using the chosen static host. For GitHub Pages, use the repository's deployment workflow if provided, configure Pages to use GitHub Actions, and run the deployment. Verify the resulting URL before adding it to the repository's Website field or README.
10. Create a release with the implemented features, model boundaries, and reproducible example. Confirm any package name's availability before considering npm publication.

The local CLI already works with `node bin/backoff-lab.js`; no npm publication is required for a useful first release. Add real clone commands, badges, and demo links only after their targets exist.

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

Before posting, append the verified repository and demo links. This is a draft; nothing has been posted automatically.

## 中文宣传草稿

**标题：** 做了一个重试策略显微镜：把惊群效应和 Jitter 画成可检查的时间线

Backoff Lab 可以让一批客户端同时访问正在恢复的服务，对比固定延迟、指数退避和三种 Jitter。除了看整体请求压力，还能点选一个客户端，逐次查看它什么时候请求、为什么失败、等了多久、最后有没有成功。

浏览器应用与 Node.js CLI 共用一个带随机种子的确定性引擎。支持 JSON 场景导入导出、URL 分享、逐次请求 CSV 和独立 HTML 报告；无需 API Key，没有运行时依赖。

模型明确限定为有限的一批请求、服务器并发槽位和固定响应延迟。p95 只统计成功客户端，因此会和完成数量一起展示，方便讨论不同策略的取舍。

欢迎分享你在排查重试问题时遇到的难点，或提供一个值得放进示例库的场景。

发布前补上已验证的仓库与演示链接。这是可编辑草稿，尚未对外发送。

## After release

Use feedback to improve the next experiment: collect confusing labels, reproducible bug reports, missing explanations, and concrete teaching or debugging use cases. Useful follow-up work may include seed sweeps and variability displays, more accessible timeline inspection, or additional documented scenarios. Treat community interest as feedback; do not promise a star count or replace product work with unsolicited promotional messages.
