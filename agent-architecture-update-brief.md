# Agent 架构更新评估任务

请检查当前项目的 Agent 架构，评估并设计下面这套新流程如何落地。

先阅读现有代码、Prompt、搜索工具、运行日志和阶段编排。第一步只输出：

1. 当前架构与目标架构的差异。
2. 需要修改的文件和模块。
3. 推荐的数据结构与执行流程。
4. Token、并发、搜索成本和实现风险。
5. 分阶段实施计划。

先不要修改代码，等我确认方案后再实施。

## 一、核心目标

将当前 Agent 更新为：

- Lead Agent 负责任务拆解、Research Lane 分配、证据合并、去重和流程决策。
- 默认不创建可自主循环的 Research Sub Agents；先使用后端受控的 Research Lanes 并行检索互斥内容。
- 每个 Research Lane 是一次受预算约束的检索任务，只能执行分配范围内的搜索、正文读取和结构化返回。
- 独立 Verifier Agent 检查证据和推算是否可信，但 Verifier 不能直接触发搜索。
- 优先寻找目标本身的直接证据。
- 只有满足明确的搜索饱和硬规则，且直接证据仍不足后，才允许进入目标拆解与推算。
- 最终仍交付：
  - `research_report.md`
  - `verification_report.md`

## 二、总体流程

```text
用户需求
→ Lead 明确目标口径和报告大纲
→ 拆解需要直接验证的 Claims
→ Lead 分配互斥 Research Lanes
→ 后端并行执行 Research Lanes，搜索并读取网页正文
→ Lead 合并、去重、更新证据账本
→ Verifier 核验直接证据
→ Lead 决策：
   1. 证据充分：进入写作
   2. 存在明确搜索方向：定向补搜
   3. 直接证据接近饱和但不足：进入目标拆解
→ 搜索拆解变量并完成区间推算
→ Verifier 核验公式、变量、口径和敏感性
→ 定向修复、降级或标记未知
→ 输出正式报告和核验报告
```

## 三、角色与执行边界

### Lead Agent

负责：

- 定义指标、主体、地域、期间、单位和统计口径。
- 将报告目标拆成需要验证的 Claims。
- 动态创建互斥 Research Lanes。
- 合并和去重 Research Lane 结果。
- 维护 Source Card、Evidence Ledger 和 Claim Ledger。
- 根据 Verifier 结果决定继续搜索、进入推算、停止或降级。
- 生成最终报告。

### Research Lane Worker

负责：

- 只执行被分配的 Research Lane。
- 使用不同检索方向搜索候选来源。
- 打开并读取关键网页、报告或 PDF 正文。
- 返回结构化证据、来源限制和剩余缺口。
- 不生成最终结论。
- 不递归创建其他 Agent 或 Lane。
- 不向 Lead 返回完整搜索历史或大段网页正文。

执行边界：

- Research Lane Worker 可以是后端函数、队列任务或一次独立模型调用，不要求是长期运行的自主 Agent。
- 默认实现应优先使用后端并行 Lane；只有在任务复杂、上下文隔离收益明显且预算允许时，才升级为真正 Sub Agent。
- 每个 Lane 必须有固定预算、固定输入 schema 和固定输出 schema。

### Verifier Agent

负责：

- 检查原文是否真正支持 Claim。
- 检查时间、主体、地域、单位和口径。
- 检查来源是否真正独立。
- 检查是否把搜索摘要错误当成正文证据。
- 检查来源冲突和遗漏。
- 推算阶段检查公式、变量、假设、重复计算和敏感性。
- 输出具体返工任务，不直接触发无限搜索。
- 只能输出结构化 `issues` 和 `required_actions`，不能直接创建新搜索任务。

## 四、Research Lane 设计

每轮由 Lead 根据任务动态建立 `2–4` 个互斥 Lane，例如：

- 官方、监管、财报和原始披露。
- 独立第三方交叉验证。
- 反证、冲突和不同统计口径。
- 特定公司、地域、产品或时间段。
- 推算阶段的不同变量或独立验证路径。

每个 Lane 任务必须使用严格输入结构：

```yaml
lane_id: L2
phase: direct_evidence
objective: 寻找符合目标口径的独立第三方市场规模数据
claim_ids:
  - CL1
included_scope:
  - 权威研究机构
excluded_scope:
  - 公司官网
  - 已由其他 Agent 负责的监管来源
known_sources:
  - source_id: S1
    canonical_url: https://...
success_criteria:
  - 找到正文可读、方法论明确、口径匹配的数据
budget:
  max_search_calls: 1
  max_results: 10
  max_body_reads: 3
  max_runtime_seconds: 60
```

不能简单地让多个 Agent 搜索同一个宽泛问题。

## 五、搜索去重

搜索前：

- 给每个 Research Lane 明确 `included_scope` 和 `excluded_scope`。
- 提供已经发现的来源列表。
- 按来源类型、主体、地域、时间或证据目的拆分。

Lead 合并时按照以下层级去重：

1. URL 是否相同。
2. 是否转载或引用同一个原始来源。
3. 是否真正提供了新事实、新口径、新时间或反证。
4. 是否属于独立来源。

不同 URL 如果都转载同一份通稿，只能算一个独立来源。

## 六、Research Lane 输入/输出 Schema

后端必须按 schema 校验 Lane 输入和输出。模型或 Lane 不能返回任意自由文本作为后续阶段输入。

### Source Card

```yaml
source_id: S4
url: https://...
canonical_url: https://...
publisher: 发布方
source_type: official_disclosure|regulatory|financial_report|media|research_report|bidding|community|other
source_level: S|A|B|C|D
retrieved_at: "2026-06-13"
published_at: ""
body_read: true
raw_artifact_path: outputs/{run_id}/sources/S4.json
original_source:
  original_source_id: S0
  original_url: https://...
  is_reprint: false
  cited_by: []
supports_claim_ids:
  - CL1
support_level: direct|partial|background|conflict|irrelevant
evidence_summary: 与目标 Claim 相关的忠实摘要
limitations:
  - 只披露收入增速，不披露库存量
```

### Evidence Card

```yaml
evidence_id: E7
source_id: S4
claim_ids:
  - CL1
original_text_excerpt: 原文摘录或忠实摘要
excerpt_location:
  page: null
  char_start: null
  char_end: null
data:
  value: null
  unit: ""
  currency: ""
  period: ""
  region: ""
  entity: ""
method: disclosure|calculation_input|estimate_input|quote|background
support_level: direct|partial|background|conflict|irrelevant
limitations: []
```

### Claim Card

```yaml
claim_id: CL1
claim_text: 需要验证的事实、数据或判断
status: unverified|supported|partially_supported|conflicted|unknown|rejected
required_evidence:
  - 直接披露库存量或采购金额
supporting_evidence_ids:
  - E7
conflicting_evidence_ids: []
missing_items:
  - 缺少实际值，现有数据均为预测值
```

### Lane Result

```yaml
lane_id: L2
status: completed|failed|skipped
searched_focus:
  - 独立第三方市场规模
new_source_ids:
  - S4
new_evidence_ids:
  - E7
updated_claim_ids:
  - CL1
conflicts: []
unresolved_gaps:
  - 缺少实际值，现有数据均为预测值
recommended_next_action:
  action: stop|continue_direct_search|targeted_repair|switch_to_decomposition|degrade_to_unknown
  focus: 搜索监管披露
budget_used:
  search_calls: 1
  body_reads: 2
  tavily_credits: 1
  runtime_seconds: 28
```

原始网页和完整响应单独保存。传给 Lead 的上下文只包含结构化结果。

## 七、直接证据优先

不能因为第一轮没有找到目标数据，就立即使用公式推算。

只有同时满足以下条件，才允许进入拆解推算：

- 已覆盖主要原始来源和权威第三方来源。
- 已尝试不同关键词、语言、主体和口径表达。
- 已确认现有数据不匹配目标口径、无法追溯、相互冲突或确实不存在。
- Verifier 判断直接证据不能支撑目标 Claim。
- 搜索饱和硬规则判断继续直接搜索的边际收益较低。

搜索饱和必须由可计算指标判断，不能只依赖模型主观表述：

```yaml
search_saturation_rule:
  required:
    - direct_search_rounds_used >= max_direct_evidence_rounds
    - new_direct_evidence_count == 0
  any_two_of:
    - new_url_rate < 0.2
    - new_original_source_rate < 0.2
    - new_claim_coverage_count == 0
    - duplicate_or_reprint_rate > 0.6
    - high_quality_source_count_delta == 0
  result:
    saturated: true
    allowed_next_actions:
      - switch_to_decomposition
      - degrade_to_unknown
      - write_with_gap
```

字段含义：

- `new_url_rate`：本轮新增 URL 数 / 本轮返回 URL 数。
- `new_original_source_rate`：本轮新增原始来源链数 / 本轮返回来源数。
- `new_claim_coverage_count`：本轮新增可支持 Claim 的数量。
- `duplicate_or_reprint_rate`：重复 URL、转载和引用同一原始来源的比例。
- `high_quality_source_count_delta`：S/A/B 来源数量相比上一轮的新增量。

进入推算前必须记录：

```yaml
decision: switch_to_decomposition
target_claim: CL1
direct_search_status: partial
reason:
  - 已覆盖主要原始来源和权威第三方来源
  - 已有数据均为预测值，无法支撑目标实际值
preserved_direct_evidence:
  - E1
  - E4
remaining_gap:
  - 2025 年实际市场规模
```

优先只推算缺失部分。只有直接数据基本不存在时，才对整个目标建模。

## 八、目标拆解与推算

进入推算后，不要默认只使用“量 × 价”。

至少生成两条候选路径，例如：

```text
路径 A：客户数量 × 付费渗透率 × 年均支出
路径 B：主要玩家相关收入加总 + 长尾估算
路径 C：调用量 × 平均调用价格
路径 D：上级市场规模 × 目标细分占比
```

评估标准：

- 子变量是否可以获得可靠证据。
- 时间、地域和统计口径是否匹配。
- 假设数量是否过多。
- 是否存在重复计算风险。
- 是否可以由另一条独立路径验证。
- 结果对单个变量是否过度敏感。

选择：

- 一条主推算路径。
- 一条尽可能独立的验证路径。

由 Lead 将公式变量拆成互斥 Research Lanes，分别搜索和核验。

## 九、Verifier 返工协议

Verifier 只能输出结构化问题，不允许直接触发搜索，也不允许要求“重新全面搜索”。

`issue_type` 必须使用固定枚举：

```yaml
allowed_issue_types:
  - unsupported_claim        # Claim 没有证据支持
  - incompatible_scope       # 主体、地域、口径或样本范围不一致
  - stale_data               # 数据时间过旧或不是目标期间
  - missing_unit             # 缺单位、币种、数量口径
  - missing_time_period      # 缺数据期或事件时间
  - duplicate_source_chain   # 多个来源来自同一原始出处，不能算独立验证
  - weak_source_level        # 来源等级不足以支撑高影响结论
  - search_summary_used      # 错把搜索摘要当成正文证据
  - formula_error            # 推算公式错误
  - variable_missing         # 推算变量缺失
  - double_counting_risk     # 可能重复计算
  - high_sensitivity         # 结果对单一假设过度敏感
```

```yaml
verification_status: failed
issues:
  - claim_id: CL3
    issue_type: incompatible_scope
    reason: 企业数量包含全部小微企业，但采用率仅覆盖大型企业
    severity: high
    required_action:
      action_type: targeted_repair_search
      query_focus: 搜索大型企业数量，或调整采用率口径
      allowed_scope:
        - 大型企业数量
        - 与采用率一致的企业规模口径
      forbidden_scope:
        - 全量小微企业数量
        - 与原问题无关的宽泛市场搜索
      max_repair_rounds: 1
```

Lead 将问题转换成定向搜索任务。

禁止重新宽泛搜索整个目标。经过有限次数定向修复仍无法解决时，应降级、删除或标记未知。

返工硬规则：

```yaml
repair_rule:
  max_repair_rounds_per_claim: 1
  max_total_repair_rounds: 2
  allowed_actions:
    - targeted_repair_search
    - adjust_claim_scope
    - downgrade_claim
    - mark_unknown
    - remove_claim
  forbidden_actions:
    - broad_research_restart
    - unlimited_follow_up_search
    - verifier_direct_tool_call
```

## 十、搜索预算

请不要直接将全局 Skill 的预算硬编码进产品。

预算分为软预算和硬停止预算。

软预算用于提示 Lead 优先收敛搜索方向；硬预算达到后必须停止，不允许继续自动调用模型或搜索 API。

推荐默认值：

```yaml
max_direct_evidence_rounds: 2
max_complex_direct_evidence_rounds: 3
max_repair_rounds: 2
max_parallel_research_lanes: 3
max_tavily_credits_per_run: 2
max_model_calls_per_run: 6
max_total_model_tokens_per_run: 12000
max_wall_time_seconds_per_run: 180
max_sources_to_judge_per_round: 6
max_source_excerpt_chars: 420
max_body_reads_per_round: 3
```

硬停止规则：

```yaml
budget_stop_rule:
  stop_when_any:
    - tavily_credits_used >= max_tavily_credits_per_run
    - model_calls_used >= max_model_calls_per_run
    - total_model_tokens_used >= max_total_model_tokens_per_run
    - wall_time_seconds_used >= max_wall_time_seconds_per_run
    - repair_rounds_used >= max_repair_rounds
  on_stop:
    - persist_current_state
    - write_gap_report
    - record_budget_stop_reason
    - do_not_start_new_search_or_model_call
```

单轮查询、候选来源和网页阅读数量采用软预算。存在明确证据缺口时可以在硬预算内扩展，但必须记录扩展原因。

请重点评估当前产品的 Token 和搜索成本，给出合理默认值。

## 十一、上下文管理

必须避免上下文爆炸：

- 原始网页、完整工具返回、完整模型响应单独持久化。
- Lead 只接收 Source Card、Evidence Ledger、Claim Ledger、冲突记录和 Verifier 问题。
- 后续阶段不能直接拼接前面所有模型回复。
- 需要核对具体措辞、数字或口径时，再读取原始证据。
- 每个阶段使用独立、精简的 system prompt。

## 十二、运行日志

运行日志是高优先级能力，至少记录：

- Agent、阶段、模型和供应商。
- 完整 system prompt 和 user prompt。
- 模型原始响应。
- 工具调用参数与结果。
- Research Lane 任务、预算、工具调用和返回。
- 输入、输出和总 Token。
- 调用时间、耗时和错误。
- Lead 为什么继续搜索、进入推算或停止。
- Verifier 提出了什么问题。
- 最终 Claim 与证据、计算的映射。

## 十三、最终交付

继续输出两份内容：

### `research_report.md`

正常咨询报告，只呈现读者需要的分析、结论、必要来源说明和推算逻辑。

### `verification_report.md`

至少包含：

- 已确认的大纲和核验计划。
- Research Lane 任务及协调轮次。
- Lead 的继续、停止和降级决策。
- 直接证据搜索结果。
- Source Card、Evidence Ledger 和 Claim Ledger。
- 信源评分、时间和口径。
- 候选拆解路径及选用原因。
- 推算变量、公式、区间和敏感性。
- Verifier 核验及返工记录。
- 冲突、未知内容和正文映射。

## 十四、需要重点评估的问题

1. 当前任务是否需要真正创建自主 Sub Agents，还是使用后端并行 Research Lanes 即可？
2. 当前搜索工具能否读取网页正文、PDF 和报告内容？
3. 当前上下文在哪里发生重复拼接？
4. 如何持久化原始结果，同时只给 Lead 传递结构化摘要？
5. 如何实现来源级和原始来源链级去重？
6. 如何避免 Verifier 和 Lead 形成无限返工循环？
7. 当前架构哪些部分可以复用，哪些需要重构？
8. 推荐先实现哪个最小可运行版本？
