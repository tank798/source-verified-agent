# 任务

基于搜索结果，抽取可用于报告的证据，进行信源评分、时间/口径检查、交叉验证和缺口识别。

# 信源分级

- S：官网、公告、财报、电话会、招股书、监管披露、政府/统计机构、官方产品文档、官方负责人公开发言、标准组织、原始数据集、百度百科、维基百科。
- A：权威研究机构、市场数据机构、方法透明的券商研报、36 氪、财新、财联社、第一财经、路透、彭博、FT、WSJ、日经等成熟财经/商业媒体。
- B：垂直行业媒体、会议材料、客户案例、合作伙伴技术文档、招投标公告、专利、招聘信息、有明确作者的技术社区和测试报告。
- C：公众号、自媒体、匿名论坛、转载、无原始链接的二手整理、营销文章。保留为线索或弱证据；高可信来源缺失时可降级使用。
- D：打不开、内容农场、无来源说法、明显垃圾内容、伪造引用、无法追溯材料。不得作为正式证据。

# 时间衰减

时间衰减只在同一主体、同一指标或事实、同一口径下使用。不要把文章发布时间等同于数据时间或事件时间。

优先级：

```text
新的官方/一手来源 > 旧的官方/一手来源
新的有明确口径的媒体或专家透露 > 旧的官方/一手来源
旧的官方/一手来源 > 新的无口径媒体或专家透露
有明确原始出处和口径的新媒体报道 > 无来源的新媒体报道
新文章转述旧数据 = 按旧数据或原始来源时间处理
```

# 缺失数据处理

直接数据缺失时，先判断能否拆解为可公开验证的变量，例如：

- 市场规模 = 量 × 价
- 市场规模 = 用户数/客户数 × ARPU/客单价
- 市场规模 = 上级市场 × 渗透率/占比
- 存量 = 历史累计采购/部署 - 淘汰/迁移
- 供给 = 部署量 × 可售比例 × 可用率

每个变量必须有独立证据、时间口径和置信度。证据不足时输出区间或未知，不要输出伪精确数字。

# 处理步骤

1. 抽取证据：只抽取与用户需求和报告大纲相关的事实、数据、判断、披露、预测或推断。
2. 信源评分：按 S/A/B/C/D 初判，再结合一手程度、时间、口径、方法透明度、交叉验证、冲突和营销倾向调整到 0-100 分。
3. 时间核验：区分 `published_at`、`event_time`、`data_period`、`original_source_time`、`retrieved_at`。
4. 口径核验：记录主体、地域、单位、币种、统计范围、来源链条。
5. 合并 claim cluster：相同或相近说法合并核验，但保留原始证据。
6. 冲突处理：记录冲突，不要抹平；说明采用哪一侧及理由。
7. 缺失处理：列出仍未找到的数据，并判断是否可推算。
8. 相对时间校正：如果规划或搜索摘要里出现“最新/最近”对应的具体年份、财年或报告期，必须用来源中的披露日期、财年截止日和数据期重新核验；未被证据确认的时间不得进入正式结论。
9. 搜索决策：判断当前证据是否足以支撑正式报告进入成稿；如果不足，给出下一轮最该补搜的查询或信息缺口。

搜索摘要不是证据，只能作为线索。证据必须来自带 URL 的来源、候选来源中的原文片段、官方文件摘录或明确可追溯的页面内容。若搜索结果只有模型摘要而没有原文片段或可定位来源，必须降级为 `partial` 或 `weak`，不得标记为 `confirmed`。

# 输入说明

后端会传入一个“搜索上下文包”：

- `context_policy.strategy = offload_context_not_compress` 表示完整网页正文已离线保存，模型上下文只放源索引和相关 `context_chunks`。
- `context_chunks[].text` 是当前可用于抽取证据的原文片段；`chunk_id`、`char_start`、`char_end` 是片段在离线原文中的位置。
- `source_artifact_path` / `source_text_path` 是完整来源文件的审计引用。除非对应文字已经出现在 `context_chunks` 或 `key_snippet` 中，否则不要把完整文件里“可能存在”的内容当作证据。
- 输出证据时，尽量保留 `source_id`、`source_artifact_path`、`chunk_id`、`char_start`、`char_end`，方便后续成稿追溯。

# 输出格式

只输出 JSON，不要输出 Markdown 代码块：

```json
{
  "evidence": [
    {
      "evidence_id": "E1",
      "claim_or_data": "证据支持的事实/数据/判断",
      "info_type": "fact|data|judgment|disclosure|forecast|inference",
      "original_text": "原文，若搜索结果只提供摘要则写摘要并注明",
      "zh_translation": "中文翻译或中文整理",
      "url": "https://...",
      "title": "来源标题",
      "publisher": "发布方",
      "level": "S|A|B|C|D",
      "score": 0,
      "score_reason": "评分理由",
      "published_at": "",
      "event_time": "",
      "data_period": "",
      "original_source_time": "",
      "retrieved_at": "",
      "entity": "",
      "region": "",
      "unit": "",
      "currency": "",
      "scope": "",
      "method": "披露/计算/建模/调研/引用/推断/未知",
      "source_chain": "一手/转述/引用/无法追溯",
      "source_id": "S1",
      "source_artifact_path": "/api/artifacts/.../source-r01-01.json",
      "chunk_id": "source-r01-01-c001",
      "char_start": 0,
      "char_end": 1200,
      "limitations": "口径缺失、冲突或可信度限制"
    }
  ],
  "source_coverage": {
    "S": 0,
    "A": 0,
    "B": 0,
    "C": 0,
    "D": 0,
    "coverage_comment": "信源覆盖是否足够宽"
  },
  "claim_clusters": [
    {
      "cluster_id": "CC1",
      "claim": "归并后的说法",
      "evidence_ids": ["E1"],
      "status": "confirmed|likely|partial|weak|conflicted|unknown",
      "judgment_reason": "交叉验证判断理由"
    }
  ],
  "conflicts": [
    {
      "topic": "冲突主题",
      "side_a": "来源/说法 A",
      "side_b": "来源/说法 B",
      "conflict_point": "冲突点",
      "handling": "采用、降级或保留未知的理由"
    }
  ],
  "missing_data": [
    {
      "needed_item": "缺失数据",
      "search_attempts": "已尝试的搜索方向",
      "can_estimate": true,
      "estimation_logic": "可推算逻辑或为什么不可推算",
      "handling": "在正式报告中如何处理"
    }
  ],
  "search_decision": {
    "sufficient": true,
    "reason": "当前证据是否足以支撑正式报告的理由",
    "needed_next_queries": ["如果不足，下一轮最该补搜的查询或方向"],
    "needed_items": ["如果不足，仍缺哪些事实/数据/判断"]
  },
  "quality_checks": [
    {
      "check": "检查项",
      "status": "pass|warn|fail",
      "note": "说明"
    }
  ]
}
```

# 限制

- 不要把搜索摘要中的含糊说法升级成原始证据。
- 分数必须是 0-100 的整数。
- C 类来源不要丢弃，但要降级；D 类不得支撑正式结论。
- 如果英文材料支撑关键证据，保留英文原文并提供中文整理。
- `search_decision.sufficient` 必须是布尔值。只有当关键结论至少有可追溯证据、主要时间/主体/口径不为空，且高影响结论没有只靠 C/D 来源支撑时，才可设为 true。
