# Source-Verified Research Skill：PPT 生图 Prompts

本文档用于让 ChatGPT 按页生成一套展示 `source-verified-research` Skill 设计思路与迭代过程的 PPT 页面图片。

## 全局视觉规范

将下面的要求附加到每一页 Prompt：

- 画幅：16:9，1920×1080，适合正式答辩和技术方案汇报。
- 风格：专业咨询报告与 AI 系统架构图结合，清晰、克制、现代。
- 背景：白色或极浅灰色，使用深灰、藏蓝、绿色和少量橙色强调；不要使用渐变、装饰性光球或卡通插画。
- 排版：标题清晰，信息密度适中，流程图和代码面板为主要视觉元素。
- 代码：使用深色等宽字体代码面板，保留指定代码原文，不得随意改写关键字段。
- 中文：所有主要文字使用简体中文，确保文字正确、清晰、可读。
- 一致性：Lead Agent 使用藏蓝色，Research Sub Agents 使用青绿色，Verifier 使用橙色，证据与报告使用深灰色。
- 不要添加无关品牌 Logo、人物照片或虚构数据。

---

## P1：封面页

### 页面目标

用一句话概括 Skill 的价值：把普通 AI 调研变成可核验、可追溯、能处理信息缺失的研究流程。

### 给 ChatGPT 的生图 Prompt

```text
生成一张 16:9 的中文技术方案 PPT 封面页。

主标题：
Source-Verified Research Skill

中文副标题：
从“会搜索”到“可核验、可推断、可追溯”的行业调研 Agent

页面中央绘制一条简洁的研究流水线：
用户问题 → 多 Agent 搜索 → 证据核验 → 受控推算 → 双报告交付

在流水线下方放置四个短标签：
信源分级
交叉验证
信息缺失推断
证据追溯

右下角用小号等宽字体展示真实 Skill 名称：
$source-verified-research

整体风格为专业咨询报告与 AI 系统架构图结合，白色背景，藏蓝、青绿色和橙色强调，信息克制，不要插画人物，不要渐变。
```

---

## P2：为什么需要这个 Skill

### 页面目标

展示 AI 辅助行业调研的四类典型问题，以及 Skill 对应的解决机制。

### 给 ChatGPT 的生图 Prompt

```text
生成一张 16:9 的中文 PPT 信息图，标题为：
AI 行业调研的四类核心失效

采用左右对照布局。

左侧标题“常见问题”，放置四个红色或灰红色问题模块：
1. 不分辨信源质量
2. 信源覆盖偏窄
3. 缺乏独立交叉验证
4. 信息缺失时无法有效整合和推断

右侧标题“Skill 的对应机制”，放置四个绿色解决方案模块，并用连线与左侧对应：
1. S/A/B/C/D 信源分级 + 网页正文核验
2. Lead 拆分互斥 Research Lane
3. 独立 Verifier + 来源链去重
4. 直接证据饱和后，进入目标拆解与区间推算

页面底部突出一句结论：
核心不是让模型“搜得更多”，而是让它知道什么可信、还缺什么、何时继续、何时推断。

使用白色背景、专业咨询风格、简洁图标和清晰连线。不要用卡通人物。
```

---

## P3：初版 Skill：完整但偏静态的研究 SOP

### 页面目标

展示最初版本已经具备信源评分、交叉验证、推算和双报告交付，但仍是一个长且偏顺序执行的单 Agent SOP。

### 给 ChatGPT 的生图 Prompt

```text
生成一张 16:9 的中文技术复盘 PPT，标题为：
V1：从“直接回答”升级为完整研究 SOP

左侧绘制初版单 Agent 的纵向 12 步流程：
理解任务 → 生成大纲 → 用户确认 → 拆解任务 → 收集信源 → 抽取证据 → 核验信息 → 交叉验证 → 缺失处理 → 构建逻辑链 → 写正式报告 → 写核验报告

右上角放置“初版已解决”的四个绿色标签：
信源等级
时间与口径
交叉验证
双报告交付

右下角放置“初版局限”的三个橙色标签：
规则集中在一个长 SKILL.md
搜索轮次按来源类型机械分层
推算是方法库，缺少进入门槛与 Agent 编排

页面中放置一个深色代码面板，必须准确展示以下初版真实 Prompt 片段：

如果可以联网搜索或用户提供材料，针对每个核心主题最多进行三轮搜索：
1. 第一轮：官网、财报、公告、电话会、官方文档、统计机构、监管披露
2. 第二轮：权威第三方机构、券商研报、成熟财经媒体
3. 第三轮：公众号、自媒体、论坛、社区、转载文章

视觉上表现为一个大型单 Agent 节点承载全部步骤，强调“完整但偏静态”。白色背景，技术架构风格。
```

---

## P4：真实运行反馈推动迭代

### 页面目标

展示不是凭空设计，而是从真实运行日志中发现搜索结果为空、正文读取超时、上下文和 Token 增长等问题。

### 给 ChatGPT 的生图 Prompt

```text
生成一张 16:9 的中文技术复盘 PPT，标题为：
从运行日志发现：有搜索调用，不等于获得有效证据

页面左侧绘制一条运行链路：
Plan → Web Search → Source Judge → Web Extract → Synthesis

在链路中标出三个红色故障点：
1. Web Search 返回大量 URL，但没有 key_snippet
2. Source Judge 判断证据不足
3. Web Extract 读取正文超时，最终跳过成稿

右侧放置一个深色“audit.jsonl”日志面板，准确展示以下关键日志摘要：

sourceCount: 50
webSearch: 1
webExtractor: 0
search_decision.sufficient: false
web_extract: network_error
durationMs: 300004
synthesis_skipped: 没有可核验的真实来源

页面底部放置三条由日志推导出的设计要求：
- 搜索摘要不能当作证据，关键来源必须读取正文
- Lead 只能接收压缩后的证据卡，不能反复拼接完整历史
- 必须让 Agent 判断“继续搜索、停止、还是进入推算”

使用白色背景、藏蓝流程线、红色故障标记、深色日志代码面板，像真实系统复盘页。
```

---

## P5：Skill 的迭代路径

### 页面目标

清晰展示从单 Agent 长 SOP，逐步迭代到当前 Multi-Agent 双路径架构。

### 给 ChatGPT 的生图 Prompt

```text
生成一张 16:9 的中文 PPT 时间线，标题为：
Skill 迭代：从静态规则到可决策的研究系统

横向展示三个主要版本。

V1：单 Agent 研究 SOP
- 一个长 SKILL.md
- 固定三轮来源分层
- 已有评分、交叉验证、推算方法和双报告

V2：有界证据循环
- 精简主 SKILL.md，详细规则下沉 references
- 区分搜索摘要与网页正文
- Source Card / Evidence Ledger / Claim Ledger
- 根据证据缺口决定继续或停止

V3：Multi-Agent + 受控推算
- Lead 编排互斥 Research Lane
- 独立 Verifier
- 直接证据优先
- switch_to_decomposition 后才允许目标拆解
- 主推算路径 + 独立验证路径

在三个版本之间使用清晰箭头，并在箭头上标注：
减少重复 → 增强决策 → 提升可审计性

底部突出最终设计原则：
搜索有界、行动可扩展、推算有门槛、证据可追溯

采用专业技术路线图风格，白色背景，版本节点清晰，V1 灰色、V2 蓝色、V3 绿色。
```

---

## P6：当前 Skill 的 Progressive Disclosure 结构

### 页面目标

展示 Skill 不是把所有规则塞进一个 Prompt，而是精简主流程，并按阶段加载 references。

### 给 ChatGPT 的生图 Prompt

```text
生成一张 16:9 的中文软件架构 PPT，标题为：
设计原则：主 Skill 保持精简，详细规则按需加载

左侧绘制文件树，必须准确展示：

source-verified-research/
├── SKILL.md
├── agents/openai.yaml
└── references/
    ├── multi-agent-research.md
    ├── evidence-loop.md
    ├── context-management.md
    ├── decomposition-workflow.md
    ├── data-estimation.md
    ├── source-scoring.md
    └── report-templates.md

右侧绘制主 SKILL.md 到各 reference 的按需路由关系：
- 多 Agent 协作 → multi-agent-research.md
- 搜索判断 → evidence-loop.md
- 长任务上下文 → context-management.md
- 目标拆解 → decomposition-workflow.md
- 具体公式 → data-estimation.md
- 信源评分 → source-scoring.md
- 最终输出 → report-templates.md

放置一个深色代码面板，准确展示关键 Prompt：

搜索循环、预算和停止判断见 `references/evidence-loop.md`。
目标拆解和推算门槛见 `references/decomposition-workflow.md`。

页面底部写：
Progressive Disclosure：只在需要时加载详细规则，降低上下文负担。

风格像软件架构文档，白色背景，文件树清晰，代码面板可读。
```

---

## P7：当前整体架构：Lead、Research Sub Agents、Verifier

### 页面目标

展示 Multi-Agent 的角色边界、并行搜索和决策闭环。

### 给 ChatGPT 的生图 Prompt

```text
生成一张 16:9 的中文 Multi-Agent 架构 PPT，标题为：
当前架构：Lead 决策，Research 搜索，Verifier 质检

页面中心放置藏蓝色 Lead Agent，标注职责：
定义目标与 Claims
拆分互斥 Research Lane
合并去重
维护证据账本
决定继续、推算或停止

Lead 左侧并行连接 3 个青绿色 Research Sub Agent：
R1 原始来源与官方披露
R2 独立第三方交叉验证
R3 反证、冲突与口径差异

Lead 右侧连接橙色 Verifier Agent，标注：
检查正文支持范围
检查来源独立性
检查时间与口径
返回定向返工任务

下方绘制完整闭环：
Lead 分配 → Research 并行搜索与正文阅读 → Lead 合并去重 → Verifier 核验 → Lead 决策

放置一个深色代码面板，准确展示真实 Skill 关键 Prompt：

将当前 Agent 作为 Lead。
若环境支持 Sub Agents，则由 Lead 每个协调轮次动态分配 `2–4` 个互斥 Research Lane。
每个 Sub Agent 只负责自己的任务边界，不得递归创建更多 Agent。

强调 Research Agent 不写最终结论，Verifier 不直接触发无限搜索。
```

---

## P8：互斥 Research Lane 与去重协议

### 页面目标

说明“多 Agent”不是让多个 Agent 搜同一个问题，而是通过任务边界和来源链去重提升覆盖效率。

### 给 ChatGPT 的生图 Prompt

```text
生成一张 16:9 的中文技术设计 PPT，标题为：
避免重复搜索：先拆互斥 Lane，再按来源链去重

左侧展示搜索前的任务拆分：
R1：监管、统计机构、官方披露
R2：权威研究机构与独立第三方
R3：冲突、反证、不同统计口径

在每个 Lane 下方显示 included_scope、excluded_scope、known_sources 三个字段。

中间放置深色 YAML 代码面板，准确展示：

task_id: R2
phase: direct_evidence
objective: 寻找符合目标口径的独立第三方市场规模数据
included_scope:
  - 权威研究机构
excluded_scope:
  - 公司官网
  - 已分配给 R1 的监管来源
known_sources:
  - https://example.com/already-found

右侧展示 Lead 的四层去重漏斗：
1. 相同 URL
2. 是否引用同一原始来源
3. 是否提供新事实、新口径、新时间或反证
4. 是否真正属于独立来源

底部突出一句：
不同 URL 若转载同一份通稿，只计算为一个独立来源。

使用专业数据工程与系统架构风格，结构清晰，不要卡通。
```

---

## P9：证据账本与上下文压缩

### 页面目标

展示如何解决长任务上下文爆炸，以及不同阶段之间真正传递什么。

### 给 ChatGPT 的生图 Prompt

```text
生成一张 16:9 的中文技术 PPT，标题为：
上下文管理：原始材料持久化，Agent 之间只传证据账本

左侧绘制大量原始材料：
网页正文、PDF、完整工具返回、模型原始响应
这些材料进入“Raw Evidence Store”，不直接反复塞给 Lead。

中间绘制三个结构化账本：
Source Card
Evidence Ledger
Claim Ledger

右侧绘制 Lead Agent，只接收压缩后的账本、冲突记录和 Verifier 问题。

页面下方放置三个并排的深色 YAML 小代码面板，准确展示：

Source Card：
source_id: S1
provenance: tool
body_read: true
original_source: ""
supports: [CL1]

Evidence Ledger：
evidence_id: E1
source_id: S1
claim_ids: [CL1]
support_scope: ""
confidence: high

Claim Ledger：
claim_id: CL1
supporting_evidence_ids: [E1]
contradicting_evidence_ids: []
status: likely
unresolved_gaps: []

底部突出：
不要默认携带完整网页正文、全部搜索摘要或前一阶段完整回答。

整体像数据流架构图，白色背景，信息清晰，强调“压缩但可回查”。
```

---

## P10：有界证据循环与关键决策 Prompt

### 页面目标

展示 Agent 的核心不在于循环本身，而在于每轮后根据证据状态决定下一步。

### 给 ChatGPT 的生图 Prompt

```text
生成一张 16:9 的中文决策流程 PPT，标题为：
Agent 的核心：每轮后判断“继续、停止，还是进入推算”

绘制一个完整协调轮次：
Lead 列出证据缺口
→ 分配互斥 Research Lane
→ Research Agents 搜索并阅读正文
→ Lead 合并去重
→ Verifier 核验
→ Lead 决策

Lead 决策节点分成三条路径：
continue_direct_search：仍有明确高价值搜索方向
stop：直接证据充分，进入写作
switch_to_decomposition：直接证据接近饱和但不足

页面右侧放置深色 YAML 代码面板，准确展示关键决策 Prompt：

decision: continue_direct_search # stop / switch_to_decomposition
round_completed: 2
supported_claims:
  - CL1
unresolved_gaps:
  - 缺少符合目标口径的实际值
reason: 已有来源均为预测值，仍可定向搜索监管披露
next_actions:
  - 搜索特定监管数据库

页面底部放置预算规则：
直接证据阶段普通任务最多 3 个协调轮次，复杂任务最多 5 个；
查询和正文阅读数量是软预算，可按明确证据缺口扩展。

使用专业决策树风格，三条决策路径颜色清晰。
```

---

## P11：直接证据不足后，才进入目标拆解与推算

### 页面目标

突出“推算是受控降级路径”，不是第一轮没搜到就直接使用公式。

### 给 ChatGPT 的生图 Prompt

```text
生成一张 16:9 的中文技术方案 PPT，标题为：
推算不是默认答案，而是直接证据饱和后的受控降级

左侧绘制“直接证据路径”：
搜索直接披露 → 阅读正文 → 交叉验证 → Verifier 判断

中间设置一个橙色 Gate，标题：
是否满足 switch_to_decomposition 门槛？

Gate 下方列出五项门槛：
已覆盖主要原始来源和权威第三方
已尝试不同关键词、语言、主体和口径
现有直接数据不匹配、无法追溯、冲突或不存在
Verifier 判断直接证据不足
Lead 判断继续搜索边际收益低

右侧绘制“拆解推算路径”：
生成多条候选路径 → 选择主路径 → 选择独立验证路径 → 搜索变量 → 计算区间 → Verifier 核验

在右下角展示候选公式：
路径 A：客户数量 × 付费渗透率 × 年均支出
路径 B：主要玩家相关收入加总 + 长尾估算
路径 C：调用量 × 平均调用价格
路径 D：上级市场规模 × 目标细分占比

放置深色 YAML 代码面板，准确展示：

decision: switch_to_decomposition
target_claim: CL1
direct_search_status: partial
preserved_direct_evidence:
  - E1
  - E4
remaining_gap:
  - 2025 年实际市场规模

底部突出：
优先只推算缺失部分；直接数据基本不存在时，才对整个目标建模。
```

---

## P12：Verifier：把“自我感觉可信”变成独立质检

### 页面目标

展示 Verifier 与 Research Agent 分离，防止模型自己搜索后自己证明自己。

### 给 ChatGPT 的生图 Prompt

```text
生成一张 16:9 的中文技术质检 PPT，标题为：
独立 Verifier：不负责找答案，只负责发现答案为什么不可信

左侧绘制 Research Agents 提交的证据包：
Source Cards
Evidence Ledger
Claim Ledger
计算与假设

中间绘制橙色 Verifier Agent，像审计关卡一样检查：
原文是否真的支持 Claim
时间、主体、地域、单位、口径是否一致
来源是否真正独立
是否把搜索摘要当作正文证据
推算是否遗漏变量或重复计算
主路径与验证路径是否真正独立

右侧绘制结构化返工任务返回 Lead。

放置深色 YAML 代码面板，准确展示：

verification_status: failed
issues:
  - claim_id: CL3
    issue_type: incompatible_scope
    reason: 企业数量包含全部小微企业，但采用率仅覆盖大型企业
    required_action: 搜索大型企业数量，或调整采用率口径

页面底部突出：
Verifier 不直接触发无限搜索；两次定向修复后仍无法解决，则降级、删除或标记未知。

整体视觉像审计与质量控制系统，白色背景，橙色质检节点突出。
```

---

## P13：最终交付：一份给读者，一份给审计

### 页面目标

展示为什么最终固定输出两份报告，以及这两份报告如何连接。

### 给 ChatGPT 的生图 Prompt

```text
生成一张 16:9 的中文咨询报告 PPT，标题为：
双报告交付：阅读体验与证据审计同时成立

页面左侧展示文档 `research_report.md`，样式像简洁正式咨询报告，包含：
执行摘要
核心分析
关键结论
必要推算逻辑
正文中的 [CL1]、[CL2] 标记

页面右侧展示文档 `verification_report.md`，样式像详细审计报告，包含：
多 Agent 任务与协调轮次
Lead 继续、停止和降级决策
信源评分与证据表
候选拆解路径与推算过程
Verifier 返工记录
冲突、未知内容和正文映射

用清晰连线表现：
正文 Claim [CL1]
→ Evidence IDs
→ Calculation IDs
→ 原始来源

页面中央下方放置真实核心 Prompt：

1. `research_report.md`：按用户需求撰写的正式报告。
2. `verification_report.md`：记录搜索决策、信源、证据原文、翻译、口径、评分、计算、冲突、缺口和正文映射的核验报告。

底部结论：
正式报告负责“可读”，核验报告负责“可信、可追溯、可复查”。

视觉风格为高质量咨询交付物展示，白色背景，两个文档清晰对照。
```

---

## P14：Skill 如何系统性解决最初问题

### 页面目标

用结果矩阵总结整个设计，并说明 Skill 的能力边界。

### 给 ChatGPT 的生图 Prompt

```text
生成一张 16:9 的中文总结 PPT，标题为：
从问题到机制：Skill 如何提升行业调研可靠性

页面主体为四行矩阵：

问题：不分辨信源质量
机制：S/A/B/C/D 分级、正文核验、来源追溯、时间与口径检查

问题：信源覆盖偏窄
机制：Lead 动态拆分互斥 Research Lane，多方向并行检索

问题：缺乏交叉验证
机制：独立 Verifier、来源链去重、Claim Ledger、冲突记录

问题：信息缺失时无法整合和推断
机制：直接证据优先、switch_to_decomposition、候选路径比较、区间推算和敏感性分析

页面右侧放置一个醒目的结论框：
Skill 提供的是高质量研究 SOP 与决策协议；
稳定执行仍需要 Agent 编排器、工具能力和评测集保障。

页面底部展示三个后续评测方向：
是否优先使用直接证据
是否识别非独立转载与口径冲突
关键变量缺失时是否拒绝编造

整体为专业总结页，矩阵清晰，结论突出，白色背景。
```

---

## 使用建议

1. 每次只向 ChatGPT 提交一页 Prompt，避免一次生成多页导致文字错误。
2. 若页面中的中文或代码出现错误，要求 ChatGPT 在保持布局不变的情况下，仅修正文字。
3. 生成后将图片作为 PPT 页面底图，再在 PowerPoint 中覆盖关键标题和代码，以保证答辩时文字绝对清晰。
4. P3、P4、P5 共同讲清迭代过程；P7–P12 是设计主体；P13–P14 用于收束价值。
5. 若答辩时间较短，可优先保留 P1、P2、P5、P7、P9、P10、P11、P13、P14。
