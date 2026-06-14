# 任务

基于当前搜索结果，做轻量信源判断和下一步决策。不要生成完整证据表，不要写正式报告。

# 判断目标

你只需要回答：当前搜索结果是否足以支撑后续进入完整证据抽取和成稿。

判断时检查：

1. 是否有可追溯 URL。
2. 是否至少包含官方/一手来源或权威第三方来源。
3. 关键结论是否缺少主体、时间、地域、单位、口径。
4. 搜索结果是否包含明显占位链接、不可打开链接或无法追溯说法。
5. `context_chunks` / `key_snippet` 是否包含清洗后的网页正文，正文是否真正支持目标 Claim。
6. 如果直接数据缺失，是否已有足够变量用于后续推算。

# 输入说明

后端会传入一个“搜索上下文包”：

- `context_policy.strategy = offload_context_not_compress` 表示完整网页正文已离线保存到 `source_artifact_path` / `source_text_path`，当前上下文只放索引和与任务最相关的 `context_chunks`。
- 判断证据时只能使用已展示的 `context_chunks`、`key_snippet`、URL、标题、发布方和时间字段。
- 如果你认为完整原文可能有更多信息，但当前 chunk 没展示，不要臆造；应在 `needed_items` 或 `verifier_issues` 中标记需要回读/补查的具体缺口。
- `source_artifact_path` 只用于可追溯审计，不代表你已经看过完整文件。

# 输出格式

只输出 JSON，不要输出 Markdown 代码块：

```json
{
  "source_coverage": {
    "S": 0,
    "A": 0,
    "B": 0,
    "C": 0,
    "D": 0,
    "coverage_comment": "当前来源覆盖情况"
  },
  "quality_checks": [
    {
      "check": "检查项",
      "status": "pass|warn|fail",
      "note": "说明"
    }
  ],
  "search_decision": {
    "sufficient": false,
    "reason": "是否足以进入下一步的理由",
    "needed_next_queries": ["如果不足，下一轮最该补搜的查询或方向"],
    "needed_items": ["如果不足，仍缺哪些事实/数据/判断"]
  },
  "verifier_issues": [
    {
      "claim_id": "CL1",
      "issue_type": "unsupported_claim",
      "reason": "问题说明",
      "severity": "low|medium|high",
      "required_action": {
        "action_type": "targeted_repair_search|adjust_claim_scope|downgrade_claim|mark_unknown|remove_claim",
        "query_focus": "只针对缺口的补搜方向，不得宽泛重搜",
        "allowed_scope": ["允许搜索或修正的范围"],
        "forbidden_scope": ["禁止扩展的范围"],
        "max_repair_rounds": 1
      }
    }
  ]
}
```

# 限制

- `search_decision.sufficient` 必须是布尔值。
- 如果来源 URL 是省略号、占位符、不可追溯链接，必须降级，并倾向于继续补搜。
- 如果没有真实 Tavily Search 调用记录，必须在 `quality_checks` 中标为 warn 或 fail。
- 不得把 Tavily 相关性分数当作信源可信度评分。
- `needed_next_queries` 最多 3 条，按执行优先级排序；后端只会执行第一条。
- `verifier_issues.issue_type` 只能使用：`unsupported_claim`、`incompatible_scope`、`stale_data`、`missing_unit`、`missing_time_period`、`duplicate_source_chain`、`weak_source_level`、`search_summary_used`、`formula_error`、`variable_missing`、`double_counting_risk`、`high_sensitivity`。
- Verifier 不能要求“重新全面搜索”；只能给出定向修复、降级、标记未知或删除 Claim。
