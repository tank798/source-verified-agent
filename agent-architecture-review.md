# Agent 架构复审与升级建议

## 当前定位

当前项目属于“有限状态工作流 Agent”，不是自由循环型 ReAct Agent，也不是真正的 Multi-Agent 系统。

现有主流程：

```text
用户需求
→ Plan 模型生成大纲、首轮查询和核验项
→ 后端执行 1 次 Tavily Search
→ Judge 模型判断证据是否足够
→ 不足时，后端执行 Judge 给出的首个补搜查询
→ Judge 再判断一次
→ 后端确定性生成证据表
→ 证据足够时调用成稿模型；不足时生成确定性缺口报告
```

这套结构适合当前阶段：调用上限明确、不会无限循环、成本可预测、日志可审计。

## 本轮已完成的关键升级

1. 搜索执行权收回后端，使用 Tavily Search；模型不再直接调用千问 `web_search`。
2. 每轮最多一次 Tavily Search，最多两轮。
3. 第一轮查询来自 Plan，第二轮查询来自 Judge 的证据缺口决策。
4. Tavily `raw_content` 作为网页正文来源，不再调用千问 `web_extractor`。
5. 完整 Tavily 请求、响应、耗时、结果数、正文结果数和 Credit 用量单独持久化。
6. Judge 只接收每轮最多 6 个 Source Card，每个正文片段最多 420 字，避免上下文爆炸。
7. Plan 只生成一个首轮查询；Judge 的补搜查询按优先级排序，后端只执行第一条。

## 当前主要架构缺口

### P0：运行可靠性

- `runs` 仍存放在内存中，服务重启后无法继续任务。
- 没有用户主动取消、阶段超时总预算和单任务成本上限。
- 没有完整的阶段状态持久化，进程退出后只能查看产物，不能恢复执行。

建议：将 `RunState` 和阶段状态写入每个 run 目录的 `state.json`，每个阶段完成后原子更新。先做文件持久化，不必立即引入数据库。

### P0：证据账本

- 当前主要按 URL 去重，没有识别“多个转载 URL 引用同一原始来源”。
- Source Card、Evidence、Claim 仍混合在运行对象和最终报告中。
- 没有稳定的 Claim ID 到 Evidence ID 映射。

建议增加三个独立账本：

```json
{
  "claims": [],
  "sources": [],
  "evidence": []
}
```

其中 Source Card 必须包含 `canonical_url`、`original_source_id`、`body_read`、`source_level` 和 `supports_claim_ids`。

### P1：搜索饱和判断

当前只依据 Judge 的主观判断决定是否补搜，没有确定性的饱和指标。

建议同时记录：

- 新 URL 比例。
- 新原始来源链比例。
- 新 Claim 覆盖数量。
- 新事实或新口径数量。
- 与上一轮重复来源比例。

当第二轮新增独立来源和 Claim 覆盖接近零时，Lead 才能明确记录“搜索接近饱和”。

### P1：Verifier 边界

当前 Judge 同时负责来源判断和流程决策，职责偏多。

推荐拆成两个受限阶段，而不是立即创建长期运行的独立 Agent：

```text
Source Verifier：判断正文是否支持 Claim、检查时间和口径
Lead Decision：根据 Verifier 的结构化问题决定补搜、停止或降级
```

Verifier 只能返回有限的 `required_actions`，不能自己触发搜索，从结构上避免无限返工。

### P1：PDF 与报告正文

Tavily Search 的 `raw_content` 能覆盖普通网页，但 PDF、扫描报告、复杂前端页面仍可能缺失。

建议增加独立的 `document_extract` 后端工具：

- 只处理已经由 Tavily 返回的 URL。
- 支持 PDF 文本抽取和页码定位。
- 完整文本持久化，传给模型的仍是限长 Evidence Card。
- 单轮最多读取 2–3 个文档。

### P1：成本与上下文预算

当前搜索 Token 已清零，但 Judge 仍是主要 Token 消耗来源。

建议默认预算：

```yaml
max_search_rounds: 2
max_tavily_results_per_round: 10
max_sources_to_judge_per_round: 6
max_source_snippet_chars: 420
max_judge_output_tokens: 700
max_total_model_tokens_per_run: 12000
max_tavily_credits_per_run: 2
```

超过预算时必须停止并生成缺口报告，不能自动追加模型调用。

### P2：Multi-Agent 最小实现

当前不建议直接创建可自主循环的 Research Sub Agents。它们会增加重复搜索、Token、并发控制和恢复复杂度。

更合适的最小实现是“后端并行 Research Lanes”：

```text
Lead 生成 2–3 个互斥 Lane
→ 后端并行调用 Tavily
→ 每个 Lane 返回固定结构的 Source Cards
→ Lead 确定性合并去重
→ Verifier 一次性核验合并后的 Claim Ledger
```

Lane 必须有明确的 `included_scope`、`excluded_scope`、`claim_ids` 和搜索预算。只有复杂任务才启用并行 Lane，简单任务继续使用当前单 Lane 两轮流程。

### P2：推算门禁

文档提出的“直接证据优先”是正确的，但当前代码还没有正式的推算状态机。

建议增加明确状态：

```text
direct_search
→ direct_verify
→ search_saturated
→ decomposition_planning
→ variable_search
→ calculation_verify
→ write_or_degrade
```

只有 `search_saturated=true` 且 Verifier 明确判定直接证据不足时，才允许进入推算。推算必须保存公式、变量证据、区间和敏感性。

## 推荐实施顺序

1. 持久化 `RunState`、Claim Ledger、Source Ledger、Evidence Ledger。
2. 增加来源链去重和搜索饱和指标。
3. 将 Judge 拆成 Source Verifier 与 Lead Decision 两个精简调用。
4. 增加 PDF/报告正文读取工具。
5. 增加每次运行的 Token、Tavily Credit、耗时总预算和取消能力。
6. 最后再实现按复杂度触发的 2–3 个并行 Research Lanes。

不建议现在实现长期运行、可递归派生的自主 Sub Agents。当前产品需要的是受预算约束的并行检索工作流，而不是开放式多 Agent 对话系统。
