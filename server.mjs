import { createServer } from "node:http";
import { appendFile, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createReadStream, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const ROOT = resolve(process.cwd());
const PUBLIC_DIR = join(ROOT, "public");
const PROMPT_DIR = join(ROOT, "prompts");
const OUTPUT_DIR = join(ROOT, "outputs");
const runs = new Map();

loadDotEnv(join(ROOT, ".env"));

const config = {
  tavilyBaseUrl: process.env.TAVILY_BASE_URL || "https://api.tavily.com",
  tavilyApiKey: process.env.TAVILY_API_KEY || readSecretFile(join(ROOT, "tavily搜索 api.txt")),
  tavilySearchDepth: normalizeTavilySearchDepth(process.env.TAVILY_SEARCH_DEPTH || "basic"),
  tavilyMaxResults: Math.min(toInt(process.env.TAVILY_MAX_RESULTS, 10), 20),
  tavilyChunksPerSource: Math.min(Math.max(toInt(process.env.TAVILY_CHUNKS_PER_SOURCE, 2), 1), 3),
  tavilyIncludeRawContent: process.env.TAVILY_INCLUDE_RAW_CONTENT || "markdown",
  tavilyTimeoutMs: toInt(process.env.TAVILY_TIMEOUT_MS, 30000),
  enableWebSearch: process.env.TAVILY_ENABLE_SEARCH !== "false",
  maxSearchTasks: Math.min(toInt(process.env.MAX_SEARCH_TASKS, 1), 1),
  maxSearchRounds: Math.min(toInt(process.env.MAX_SEARCH_ROUNDS, 2), 2),
  maxResearchLanes: Math.min(Math.max(toInt(process.env.MAX_RESEARCH_LANES, 1), 1), 3),
  maxSourcesPerRound: toInt(process.env.MAX_SOURCES_PER_ROUND, 20),
  maxSourcesToJudgePerRound: Math.min(Math.max(toInt(process.env.MAX_SOURCES_TO_JUDGE_PER_ROUND, 10), 1), 16),
  maxSourceExcerptChars: Math.min(Math.max(toInt(process.env.MAX_SOURCE_EXCERPT_CHARS, 420), 160), 1200),
  sourceChunkChars: Math.min(Math.max(toInt(process.env.SOURCE_CHUNK_CHARS, 2000), 800), 6000),
  sourceChunkOverlapChars: Math.min(Math.max(toInt(process.env.SOURCE_CHUNK_OVERLAP_CHARS, 240), 80), 1200),
  maxContextChunksPerRound: Math.min(Math.max(toInt(process.env.MAX_CONTEXT_CHUNKS_PER_ROUND, 24), 4), 80),
  sourceJudgeContextBudgetChars: Math.min(Math.max(toInt(process.env.SOURCE_JUDGE_CONTEXT_BUDGET_CHARS, 60000), 12000), 180000),
  extractContextBudgetChars: Math.min(Math.max(toInt(process.env.EXTRACT_CONTEXT_BUDGET_CHARS, 120000), 24000), 220000),
  synthesizeEvidenceExcerptChars: Math.min(Math.max(toInt(process.env.SYNTHESIZE_EVIDENCE_EXCERPT_CHARS, 4000), 1200), 12000),
  synthesizeReadbackBudgetChars: Math.min(Math.max(toInt(process.env.SYNTHESIZE_READBACK_BUDGET_CHARS, 60000), 12000), 160000),
  maxContextReadRoundsPerStage: Math.min(Math.max(toInt(process.env.MAX_CONTEXT_READ_ROUNDS_PER_STAGE, 2), 0), 4),
  maxContextRequestsPerRound: Math.min(Math.max(toInt(process.env.MAX_CONTEXT_REQUESTS_PER_ROUND, 6), 1), 12),
  maxContextReadCharsPerRequest: Math.min(Math.max(toInt(process.env.MAX_CONTEXT_READ_CHARS_PER_REQUEST, 8000), 2000), 24000),
  maxTavilyCreditsPerRun: Math.max(toInt(process.env.MAX_TAVILY_CREDITS_PER_RUN, 2), 1),
  maxModelCallsPerRun: Math.max(toInt(process.env.MAX_MODEL_CALLS_PER_RUN, 10), 1),
  maxTotalModelTokensPerRun: Math.max(toInt(process.env.MAX_TOTAL_MODEL_TOKENS_PER_RUN, 200000), 10000),
  maxWallTimeSecondsPerRun: Math.max(toInt(process.env.MAX_WALL_TIME_SECONDS_PER_RUN, 180), 30),
  maxRepairRounds: Math.max(toInt(process.env.MAX_REPAIR_ROUNDS, 2), 0),
  maxRepairRoundsPerClaim: Math.max(toInt(process.env.MAX_REPAIR_ROUNDS_PER_CLAIM, 1), 0),
  textBaseUrl: process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1",
  textApiKey: process.env.SILICONFLOW_API_KEY || readSecretFile(join(ROOT, "硅基 api.txt")),
  planModel: process.env.SILICONFLOW_PLAN_MODEL || process.env.SILICONFLOW_MODEL || "Pro/MiniMaxAI/MiniMax-M2.5",
  judgeModel: process.env.SILICONFLOW_JUDGE_MODEL || process.env.SILICONFLOW_MODEL || "Pro/MiniMaxAI/MiniMax-M2.5",
  extractModel: process.env.SILICONFLOW_EXTRACT_MODEL || process.env.SILICONFLOW_MODEL || "Pro/MiniMaxAI/MiniMax-M2.5",
  synthesizeModel: process.env.SILICONFLOW_SYNTHESIZE_MODEL || process.env.SILICONFLOW_MODEL || "Pro/MiniMaxAI/MiniMax-M2.5",
  textTimeoutMs: toInt(process.env.SILICONFLOW_TIMEOUT_MS, 60000),
  textMaxOutputTokens: toInt(process.env.SILICONFLOW_MAX_OUTPUT_TOKENS, 8192),
  planMaxOutputTokens: toInt(process.env.PLAN_MAX_OUTPUT_TOKENS, 4096),
  judgeMaxOutputTokens: toInt(process.env.JUDGE_MAX_OUTPUT_TOKENS, 2048),
  extractMaxOutputTokens: toInt(process.env.EXTRACT_MAX_OUTPUT_TOKENS, 2048),
  synthesizeMaxOutputTokens: toInt(process.env.SYNTHESIZE_MAX_OUTPUT_TOKENS, 8192),
  useFullExtractionModel: process.env.ENABLE_FULL_EXTRACTION_MODEL === "true",
};

const modelOptions = [
  { label: "MiniMax M2.5 · 硅基流动", value: "Pro/MiniMaxAI/MiniMax-M2.5" },
  { label: "Qwen3.5 35B A3B · 硅基流动", value: "Qwen/Qwen3.5-35B-A3B" },
];

const allowedVerifierIssueTypes = new Set([
  "unsupported_claim",
  "incompatible_scope",
  "stale_data",
  "missing_unit",
  "missing_time_period",
  "duplicate_source_chain",
  "weak_source_level",
  "search_summary_used",
  "formula_error",
  "variable_missing",
  "double_counting_risk",
  "high_sensitivity",
]);

const allowedRepairActions = new Set([
  "targeted_repair_search",
  "adjust_claim_scope",
  "downgrade_claim",
  "mark_unknown",
  "remove_claim",
]);

const prompts = {
  base: await readPrompt("base.md"),
  plan: await readPrompt("plan.md"),
  search: await readPrompt("search.md"),
  sourceJudge: await readPrompt("source-judge.md"),
  extractScore: await readPrompt("extract-score.md"),
  synthesize: await readPrompt("synthesize.md"),
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, {
        searchModel: `Tavily ${config.tavilySearchDepth}`,
        searchProvider: "tavily",
        reportModel: config.synthesizeModel,
        webSearchEnabled: config.enableWebSearch,
        webExtractorEnabled: Boolean(config.tavilyIncludeRawContent),
        tavilyIncludeRawContent: config.tavilyIncludeRawContent,
        maxSearchTasks: config.maxSearchTasks,
        maxSearchRounds: config.maxSearchRounds,
        maxResearchLanes: config.maxResearchLanes,
        contextPolicy: {
          strategy: "offload_context_not_compress",
          sourceChunkChars: config.sourceChunkChars,
          sourceChunkOverlapChars: config.sourceChunkOverlapChars,
          maxContextChunksPerRound: config.maxContextChunksPerRound,
          sourceJudgeContextBudgetChars: config.sourceJudgeContextBudgetChars,
          extractContextBudgetChars: config.extractContextBudgetChars,
          synthesizeEvidenceExcerptChars: config.synthesizeEvidenceExcerptChars,
          synthesizeReadbackBudgetChars: config.synthesizeReadbackBudgetChars,
          maxContextReadRoundsPerStage: config.maxContextReadRoundsPerStage,
          maxContextRequestsPerRound: config.maxContextRequestsPerRound,
        },
        maxTavilyCreditsPerRun: config.maxTavilyCreditsPerRun,
        maxModelCallsPerRun: config.maxModelCallsPerRun,
        maxTotalModelTokensPerRun: config.maxTotalModelTokensPerRun,
        maxWallTimeSecondsPerRun: config.maxWallTimeSecondsPerRun,
        textProvider: "siliconflow",
        planModel: config.planModel,
        judgeModel: config.judgeModel,
        extractModel: config.extractModel,
        synthesizeModel: config.synthesizeModel,
        textModel: config.synthesizeModel,
        modelOptions,
        defaultModel: resolveRequestedTextModel(config.planModel),
        searchApiConfigured: Boolean(config.tavilyApiKey),
        textApiConfigured: Boolean(config.textApiKey),
        apiConfigured: Boolean(config.tavilyApiKey && config.textApiKey),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/agent") {
      return handleAgent(req, res);
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/artifacts/")) {
      return handleArtifact(url.pathname, res);
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      sendJson(res, { error: error.message || "Internal Server Error" }, 500);
    } else {
      res.end();
    }
  }
});

const preferredPort = toInt(process.env.PORT, 3000);
server.on("listening", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : preferredPort;
  console.log(`Source agent running at http://127.0.0.1:${port}`);
});
startServer(preferredPort);

function startServer(port, attemptsLeft = 20) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      startServer(port + 1, attemptsLeft - 1);
      return;
    }
    throw error;
  });
  server.listen(port, "127.0.0.1");
}

async function handleAgent(req, res) {
  const body = await readJsonBody(req);
  setupStream(res);

  try {
    if (body.action === "plan") {
      if (!config.textApiKey) {
        streamEvent(res, "error", { message: "缺少 SILICONFLOW_API_KEY，或缺少本地的 硅基 api.txt。" });
        return res.end();
      }
      const run = await createPlan(body.prompt || "", body.model, res);
      streamEvent(res, "done", { runId: run.id });
      return res.end();
    }

    if (body.action === "execute") {
      if (!config.tavilyApiKey) {
        streamEvent(res, "error", { message: "缺少 TAVILY_API_KEY，或缺少本地的 tavily搜索 api.txt。" });
        return res.end();
      }
      if (!config.textApiKey) {
        streamEvent(res, "error", { message: "缺少 SILICONFLOW_API_KEY，核验和成稿阶段需要硅基流动模型。" });
        return res.end();
      }
      const run = runs.get(body.runId);
      if (!run) {
        streamEvent(res, "error", { message: "未找到该 run，请重新提交需求。" });
        return res.end();
      }
      if (body.model) {
        run.model = resolveRequestedTextModel(body.model);
      }
      await executeRun(run, body.userNotes || "", res);
      streamEvent(res, "done", { runId: run.id, artifacts: run.artifacts });
      return res.end();
    }

    streamEvent(res, "error", { message: "未知 action。" });
    return res.end();
  } catch (error) {
    streamEvent(res, "error", {
      message: error.message || "执行失败",
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
    return res.end();
  }
}

async function createPlan(userPrompt, requestedModel, res) {
  const run = {
    id: makeRunId(),
    prompt: userPrompt.trim(),
    mode: "agentic-two-pass",
    model: resolveRequestedTextModel(requestedModel || config.planModel),
    createdAt: new Date().toISOString(),
    plan: null,
    searches: [],
    researchLanes: [],
    ledgers: createEmptyLedgers(),
    budget: createRunBudget(),
    budgetStopReason: "",
    judgments: [],
    searchDecision: null,
    extraction: null,
    synthesis: null,
    artifacts: null,
    auditSeq: 0,
  };
  runs.set(run.id, run);
  await ensureRunDir(run);
  await auditRunEvent(run, "run_created", {
    prompt: run.prompt,
    mode: run.mode,
    maxSearchTasks: config.maxSearchTasks,
    maxSearchRounds: config.maxSearchRounds,
    maxResearchLanes: config.maxResearchLanes,
    budgetLimits: buildBudgetLimits(),
    searchProvider: "tavily",
    tavilySearchDepth: config.tavilySearchDepth,
    tavilyMaxResults: config.tavilyMaxResults,
    webSearchEnabled: config.enableWebSearch,
    webExtractorEnabled: Boolean(config.tavilyIncludeRawContent),
    tavilyIncludeRawContent: config.tavilyIncludeRawContent,
  });

  streamEvent(res, "run", { runId: run.id, createdAt: run.createdAt });
  streamStep(res, "plan", "running", "生成报告大纲与核验计划", "把用户需求拆成报告结构、核验重点、搜索任务和缺失数据推算预案。");

  const input = [
    prompts.plan,
    "# 用户需求",
    userPrompt,
    "# 当前日期",
    todayISO(),
  ].join("\n\n");

  const response = await callTextModel({
    run,
    stage: "plan",
    model: modelForRun(run, config.planModel),
    system: prompts.base,
    input,
    maxTokens: config.planMaxOutputTokens,
    temperature: 0.2,
  });

  const outputText = getOutputText(response);
  const plan = normalizePlan(parseJsonLoose(outputText) || fallbackPlan(userPrompt));
  run.plan = plan;
  run.ledgers = initializeLedgersFromPlan(plan);
  await auditRunEvent(run, "plan_normalized", { plan });
  await persistRunState(run, "plan_normalized");

  streamEvent(res, "model_output", {
    stage: "plan",
    text: summarizeText(outputText, 1600),
  });
  streamStep(res, "plan", "completed", "计划已生成", "请确认或补充报告范围；确认后才会开始联网检索和核验。");
  streamEvent(res, "plan_ready", { runId: run.id, plan });
  return run;
}

async function executeRun(run, userNotes, res) {
  // Wall-clock budget should measure the execution phase, not the time a plan waits for user confirmation.
  run.budget.startedAt = Date.now();
  run.budget.stopReason = "";
  run.budgetStopReason = "";
  streamStep(res, "execute", "running", "开始执行已确认计划", `受控 Research Lane 流程：先检索 1 轮并轻量判定；证据不足时最多按 Verifier 缺口补搜 1 轮；达到硬预算立即停止。`);
  await auditRunEvent(run, "execute_started", { userNotes: userNotes || "", maxSearchRounds: config.maxSearchRounds });

  const task = getPrimarySearchTask(run.plan);
  run.researchLanes = buildResearchLanes(run, task);
  const lane = run.researchLanes[0];
  const taskResult = { task, lane, rounds: [] };
  run.searches = [taskResult];
  await auditRunEvent(run, "research_lanes_created", { lanes: run.researchLanes });
  await persistRunState(run, "execute_started");

  for (let round = 1; round <= config.maxSearchRounds; round += 1) {
    const startStopReason = getBudgetStopReason(run);
    if (startStopReason) {
      markBudgetStop(run, startStopReason);
      await auditRunEvent(run, "budget_stop", { stage: "before_search", reason: startStopReason, budget: run.budget });
      streamStep(res, "search", "completed", "搜索已停止", `硬预算停止：${startStopReason}`);
      break;
    }

    const priorDecision = run.searchDecision || null;
    if (round > 1) registerRepairRound(run, priorDecision);
    streamStep(res, "search", "running", `检索第 ${round} 轮`, buildSearchStatus(task, round, priorDecision, lane));
    await auditRunEvent(run, "search_round_started", { round, task, lane, priorDecision, budget: run.budget });

    let result;
    try {
      result = await runSearchRound(run, task, lane, round, taskResult.rounds, userNotes, priorDecision);
    } catch (error) {
      result = {
        round,
        lane,
        raw: null,
        text: "",
        parsed: {
          search_summary: `本轮搜索失败：${error.message || "unknown error"}`,
          missing_after_this_round: ["本轮搜索失败，需后续补搜或人工复核。"],
        },
        sources: [],
        error: error.message || "search failed",
      };
      await auditRunEvent(run, "search_round_error", { round, error: result.error });
    }

    taskResult.rounds.push(result);
    const ledgerUpdate = ingestRoundIntoLedgers(run, lane, result);
    result.ledgerUpdate = ledgerUpdate;
    result.saturation = computeSearchSaturation(taskResult);
    result.laneResult = buildLaneResult(lane, result, ledgerUpdate);
    const searchPayload = {
      taskId: task.task_id,
      laneId: lane.lane_id,
      round,
      provider: "tavily",
      error: result.error,
      summary: result.parsed?.search_summary || summarizeText(result.text, 600),
      sources: result.sources.slice(0, config.maxSourcesPerRound).map(publicSourceSummary),
      missing: result.parsed?.missing_after_this_round || [],
      toolCalls: summarizeToolCalls(result.raw),
      saturation: result.saturation,
      laneResult: result.laneResult,
    };
    streamEvent(res, "search_round", searchPayload);
    await auditRunEvent(run, "search_round_completed", {
      ...searchPayload,
      sourceCount: result.sources.length,
      toolCalls: summarizeToolCalls(result.raw),
    });
    await auditRunEvent(run, "lane_result", result.laneResult);
    await persistRunState(run, `search_round_${round}_completed`);

    const afterSearchStopReason = getBudgetStopReason(run);
    if (afterSearchStopReason) {
      markBudgetStop(run, afterSearchStopReason);
      run.searchDecision = buildBudgetStopDecision(run, afterSearchStopReason, round);
      await auditRunEvent(run, "budget_stop", { stage: "after_search", reason: afterSearchStopReason, budget: run.budget });
      break;
    }

    streamStep(res, "extract", "running", `第 ${round} 轮后判断证据是否足够`, "轻量检查来源覆盖、可追溯性、口径缺口和下一步决策。");
    let judgment;
    if (result.sources.length === 0) {
      judgment = buildNoSourceJudgment(result);
      await auditRunEvent(run, "source_judge_skipped", {
        round,
        reason: "没有真实 Tavily Search 返回来源，跳过付费模型判断。",
      });
    } else {
      try {
        judgment = await judgeSources(run, userNotes, { round });
      } catch (error) {
        const fallbackContext = buildSearchContextPack(run, { stage: "source_judge", context: { round } });
        judgment = {
          raw: null,
          text: "",
          parsed: normalizeJudge(null, fallbackContext),
          error: error.message || "source judge failed",
        };
        await auditRunEvent(run, "source_judge_error", { round, error: judgment.error });
      }
    }
    run.judgments.push(judgment);
    run.searchDecision = getSearchDecision(judgment.parsed, round);
    run.searchDecision = applySearchSaturationToDecision(run.searchDecision, result.saturation);
    run.ledgers.verifier_issues.push(...arrayify(run.searchDecision.verifier_issues));
    const extractionPayload = {
      round,
      sourceCoverage: judgment.parsed?.source_coverage || {},
      evidenceCount: 0,
      clusters: [],
      missingData: arrayify(judgment.parsed?.search_decision?.needed_items).map((item) => ({ needed_item: item })),
      qualityChecks: judgment.parsed?.quality_checks || [],
      searchDecision: judgment.parsed?.search_decision || null,
      verifierIssues: judgment.parsed?.verifier_issues || [],
      saturation: result.saturation,
    };
    streamEvent(res, "extraction", extractionPayload);
    await auditRunEvent(run, "source_judge_completed", extractionPayload);

    const decision = run.searchDecision;
    const decisionTitle = decision.sufficient
      ? "证据足够，进入完整抽取"
      : round >= config.maxSearchRounds
        ? "证据不足，结束搜索"
        : "证据不足，准备补搜";
    streamStep(res, "extract", "completed", decisionTitle, decision.reason);
    await auditRunEvent(run, "search_decision", decision);
    await persistRunState(run, `source_judge_${round}_completed`);

    const afterJudgeStopReason = getBudgetStopReason(run);
    if (afterJudgeStopReason) {
      markBudgetStop(run, afterJudgeStopReason);
      run.searchDecision = buildBudgetStopDecision(run, afterJudgeStopReason, round);
      await auditRunEvent(run, "budget_stop", { stage: "after_source_judge", reason: afterJudgeStopReason, budget: run.budget });
      break;
    }

    if (decision.sufficient || round >= config.maxSearchRounds || !canRunRepairRound(run, decision)) {
      break;
    }
  }

  streamStep(res, "extract", "running", "生成完整证据表", "搜索结束后统一抽取证据、评分、口径、冲突和缺口。");
  const actualSourceCount = countActualSources(run);
  if (actualSourceCount === 0) {
    run.extraction = {
      raw: null,
      text: "",
      parsed: normalizeExtraction(null, buildSearchContextPack(run, { stage: "extract", context: { no_sources: true } })),
      error: "没有真实搜索来源，跳过付费完整抽取。",
    };
    await auditRunEvent(run, "extraction_skipped", { reason: run.extraction.error });
  } else if (config.useFullExtractionModel) {
    try {
      run.extraction = await extractAndScore(run, userNotes, {
        round: run.searches[0]?.rounds?.length || 0,
        final: true,
        search_decision: run.searchDecision,
      });
    } catch (error) {
      run.extraction = {
        raw: null,
        text: "",
        parsed: normalizeExtraction(null, buildSearchContextPack(run, {
          stage: "extract",
          context: {
            round: run.searches[0]?.rounds?.length || 0,
            final: true,
            search_decision: run.searchDecision,
          },
        })),
        error: error.message || "完整证据抽取失败",
      };
      await auditRunEvent(run, "extraction_error", { error: run.extraction.error });
    }
  } else {
    run.extraction = buildDeterministicExtraction(run);
    await auditRunEvent(run, "extraction_deterministic", {
      reason: "使用真实来源与网页正文确定性构建证据表，避免重复模型调用。",
      evidenceCount: run.extraction.parsed.evidence.length,
    });
  }
  const finalExtractionPayload = {
    round: run.searches[0]?.rounds?.length || 0,
    sourceCoverage: run.extraction.parsed?.source_coverage || {},
    evidenceCount: (run.extraction.parsed?.evidence || []).length,
    clusters: run.extraction.parsed?.claim_clusters || [],
    missingData: run.extraction.parsed?.missing_data || [],
    qualityChecks: run.extraction.parsed?.quality_checks || [],
    searchDecision: run.extraction.parsed?.search_decision || run.searchDecision || null,
  };
  streamEvent(res, "extraction", finalExtractionPayload);
  await auditRunEvent(run, "extraction_completed", finalExtractionPayload);
  await persistRunState(run, "extraction_completed");
  streamStep(res, "extract", "completed", "完整证据表已生成", "已形成证据表、信源评分、交叉验证状态和缺口记录。");

  streamStep(res, "synthesize", "running", "生成正式报告和核验报告", "正式报告只保留必要结论，完整证据、评分和映射写入核验报告。");
  const evidenceCount = arrayify(run.extraction?.parsed?.evidence).length;
  const synthBudgetStop = getBudgetStopReason(run);
  if (synthBudgetStop) markBudgetStop(run, synthBudgetStop);
  if (run.budgetStopReason || evidenceCount === 0 || run.searchDecision?.sufficient === false) {
    const reason = evidenceCount === 0
      ? "没有可核验的真实来源，已跳过付费成稿调用。"
      : run.budgetStopReason
        ? `硬预算停止：${run.budgetStopReason}`
        : `两轮搜索后证据仍不足：${run.searchDecision.reason}`;
    run.synthesis = buildEvidenceGapSynthesis(run, reason);
    await auditRunEvent(run, "synthesis_deterministic", { reason: run.synthesis.error });
  } else {
    try {
      run.synthesis = await synthesizeReports(run, userNotes);
    } catch (error) {
      run.synthesis = buildEvidenceGapSynthesis(run, error.message || "成稿模型调用失败");
      await auditRunEvent(run, "synthesis_error", { error: run.synthesis.error });
    }
  }
  await persistRunState(run, "synthesis_completed");
  await persistArtifacts(run);
  await auditRunEvent(run, "artifacts_persisted", { artifacts: run.artifacts });
  streamEvent(res, "artifacts", {
    runId: run.id,
    artifacts: run.artifacts,
    finalQualityChecks: run.synthesis.parsed?.final_quality_checks || [],
  });
  streamStep(res, "synthesize", "completed", "文件已生成", "可以在右侧预览或下载两份 Markdown 文件。");
}

async function runSearchRound(run, task, lane, round, previousRounds, userNotes, priorDecision) {
  const query = buildTavilyQuery(run, task, round, priorDecision);
  const tavily = await callTavilySearch({ run, stage: "search", query, round });
  const sources = limitSearchSources(tavily.sources);
  const parsed = buildTavilySearchParsed({
    task,
    round,
    query,
    sources,
    previousRounds,
    priorDecision,
  });
  return {
    round,
    lane,
    raw: tavily.raw,
    text: "",
    parsed,
    sources,
  };
}

function buildTavilyQuery(run, task, round, priorDecision) {
  const nextQueries = arrayify(priorDecision?.needed_next_queries).filter(Boolean);
  const initialQueries = arrayify(task?.initial_queries).filter(Boolean);
  const chosen = round > 1
    ? nextQueries[0] || priorDecision?.needed_items?.[0]
    : initialQueries[0];
  const fallback = task?.topic || run.prompt;
  return summarizeText(chosen || fallback || run.prompt, 380);
}

function buildTavilySearchParsed({ task, round, query, sources, previousRounds, priorDecision }) {
  const bodyReadCount = sources.filter((source) => source.extracted).length;
  return {
    task_id: task.task_id || "T1",
    round,
    search_summary: `Tavily 本轮返回 ${sources.length} 个可追溯来源，其中 ${bodyReadCount} 个包含清洗后的网页正文。`,
    query_log: [query],
    source_candidates: sources.map((source) => ({
      source_artifact_id: source.source_artifact_id || "",
      source_artifact_path: source.source_artifact_path || "",
      title: source.title,
      url: source.url,
      publisher: source.publisher,
      published_at: source.published_at || "",
      source_type_guess: source.sourceType,
      likely_level: source.level || inferSourceLevel(source),
      why_relevant: source.why_relevant || `Tavily 相关性分数：${source.tavilyScore ?? "未知"}`,
      content_char_count: source.content_char_count || 0,
      chunk_count: source.chunk_count || 0,
      key_snippet: summarizeText(source.snippet, config.maxSourceExcerptChars),
    })),
    missing_after_this_round: arrayify(priorDecision?.needed_items).slice(0, 8),
    suggest_next_queries: [],
    previous_round_count: previousRounds.length,
  };
}

async function callTavilySearch({ run, stage, query, round }) {
  if (!config.enableWebSearch) throw new Error("Tavily 搜索已关闭。");
  const stopReason = getBudgetStopReason(run);
  if (stopReason) {
    markBudgetStop(run, stopReason);
    await auditRunEvent(run, "budget_stop", { stage, reason: stopReason, budget: run.budget });
    throw new Error(`预算停止：${stopReason}`);
  }
  const endpoint = `${config.tavilyBaseUrl.replace(/\/$/, "")}/search`;
  const body = {
    query,
    search_depth: config.tavilySearchDepth,
    max_results: config.tavilyMaxResults,
    topic: "general",
    include_answer: false,
    include_raw_content: config.tavilyIncludeRawContent,
    include_images: false,
    include_usage: true,
  };
  if (config.tavilySearchDepth === "advanced") {
    body.chunks_per_source = config.tavilyChunksPerSource;
  }

  const startedAt = Date.now();
  let response;
  let networkError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.tavilyApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.tavilyTimeoutMs),
      });
      break;
    } catch (error) {
      networkError = error;
      if (attempt < 2 && shouldRetryNetworkError(error)) {
        await sleep(1200);
      } else {
        break;
      }
    }
  }

  if (!response) {
    await auditToolCall({
      run,
      provider: "tavily",
      stage,
      tool: "web_search",
      requestBody: body,
      status: "network_error",
      error: networkError?.message || "fetch failed",
      startedAt,
      metadata: { round, query },
    });
    throw new Error(`Tavily API 网络调用失败：${networkError?.message || "fetch failed"}`);
  }

  const data = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok) {
    const message = data?.detail?.error || data?.detail || data?.message || JSON.stringify(data).slice(0, 500);
    await auditToolCall({
      run,
      provider: "tavily",
      stage,
      tool: "web_search",
      requestBody: body,
      responseData: data,
      status: "http_error",
      httpStatus: response.status,
      error: String(message),
      startedAt,
      metadata: { round, query },
    });
    throw new Error(`Tavily API 调用失败：${response.status} ${message}`);
  }

  let sources = normalizeTavilySources(data?.results);
  const rawContentResults = sources.filter((source) => source.extracted).length;
  const toolAudit = await auditToolCall({
    run,
    provider: "tavily",
    stage,
    tool: "web_search",
    requestBody: body,
    responseData: data,
    status: "ok",
    startedAt,
    metadata: {
      round,
      query,
      requestId: data?.request_id || "",
      responseTime: data?.response_time || null,
      credits: data?.usage?.credits ?? null,
      resultCount: sources.length,
      rawContentResults,
    },
  });
  sources = sources.map((source) => ({
    ...source,
    raw_artifact_path: toolAudit?.filePaths?.response || "",
  }));
  sources = await persistSourceArtifacts(run, sources, {
    round,
    query,
    tool_response_path: toolAudit?.filePaths?.response || "",
  });

  return {
    sources,
    raw: {
      provider: "tavily",
      output: [{
        type: "web_search_call",
        status: "completed",
        action: {
          query,
          sources: sources.map((source) => ({
            title: source.title,
            url: source.url,
            publisher: source.publisher,
          })),
        },
      }],
      usage: data?.usage || {},
      request_id: data?.request_id || "",
    },
  };
}

function normalizeTavilySources(results) {
  return arrayify(results).map((result) => {
    const rawContent = String(result?.raw_content || "").trim();
    const content = String(result?.content || "").trim();
    const fullText = compactWhitespace(rawContent || content);
    const source = {
      title: result?.title || result?.url || "",
      url: result?.url || "",
      publisher: getUrlHost(result?.url),
      published_at: result?.published_date || result?.published_at || "",
      sourceType: "tavily_search",
      extracted: Boolean(rawContent),
      snippet: summarizeText(fullText, 1800),
      full_text: fullText,
      raw_content_chars: rawContent.length,
      content_chars: content.length,
      why_relevant: `Tavily 相关性分数：${result?.score ?? "未知"}`,
      tavilyScore: result?.score ?? null,
    };
    source.level = inferSourceLevel(source);
    return source;
  }).filter((source) => /^https?:\/\//i.test(source.url));
}

async function persistSourceArtifacts(run, sources, metadata = {}) {
  if (!run?.id) return sources;
  await ensureRunDir(run);
  const enriched = [];
  for (const [index, source] of sources.entries()) {
    const roundPart = String(metadata.round || 0).padStart(2, "0");
    const indexPart = String(index + 1).padStart(2, "0");
    const stem = `source-r${roundPart}-${indexPart}`;
    const jsonFile = `${stem}.json`;
    const textFile = `${stem}.txt`;
    const fullText = compactWhitespace(source.full_text || source.snippet || source.title || "");
    const chunks = buildSourceChunks(fullText, stem);
    const sourceRecord = {
      source_artifact_id: stem,
      round: metadata.round || null,
      query: metadata.query || "",
      title: source.title || source.url || "",
      url: source.url || "",
      publisher: source.publisher || "",
      published_at: source.published_at || "",
      source_type: source.sourceType || "",
      level: source.level || "",
      extracted: Boolean(source.extracted),
      tavily_score: source.tavilyScore ?? null,
      raw_content_chars: source.raw_content_chars || 0,
      content_chars: source.content_chars || 0,
      content_char_count: fullText.length,
      chunk_chars: config.sourceChunkChars,
      chunk_overlap_chars: config.sourceChunkOverlapChars,
      chunk_count: chunks.length,
      tool_response_path: metadata.tool_response_path || "",
      full_text: fullText,
      chunks,
    };
    await writeFile(join(getRunDir(run), jsonFile), JSON.stringify(sourceRecord, null, 2), "utf8");
    await writeFile(join(getRunDir(run), textFile), fullText, "utf8");

    const { full_text: _fullText, ...sourceWithoutFullText } = source;
    enriched.push({
      ...sourceWithoutFullText,
      content_char_count: fullText.length,
      chunk_count: chunks.length,
      chunks,
      source_artifact_id: stem,
      source_artifact_file: jsonFile,
      source_artifact_path: `/api/artifacts/${run.id}/${jsonFile}`,
      source_text_file: textFile,
      source_text_path: `/api/artifacts/${run.id}/${textFile}`,
    });
  }
  return enriched;
}

function buildSourceChunks(text, artifactStem) {
  const compact = compactWhitespace(text);
  if (!compact) return [];
  const chunkSize = config.sourceChunkChars;
  const overlap = Math.min(config.sourceChunkOverlapChars, Math.max(0, chunkSize - 1));
  const step = Math.max(1, chunkSize - overlap);
  const chunks = [];
  for (let start = 0; start < compact.length; start += step) {
    const end = Math.min(compact.length, start + chunkSize);
    const chunkText = compact.slice(start, end);
    chunks.push({
      chunk_id: `${artifactStem}-c${String(chunks.length + 1).padStart(3, "0")}`,
      char_start: start,
      char_end: end,
      text: chunkText,
    });
    if (end >= compact.length) break;
  }
  return chunks;
}

function createRunBudget() {
  return {
    startedAt: Date.now(),
    tavilyCreditsUsed: 0,
    modelCallsUsed: 0,
    totalModelTokensUsed: 0,
    repairRoundsUsed: 0,
    repairRoundsByClaim: {},
    stopReason: "",
  };
}

function buildBudgetLimits() {
  return {
    max_tavily_credits_per_run: config.maxTavilyCreditsPerRun,
    max_model_calls_per_run: config.maxModelCallsPerRun,
    max_total_model_tokens_per_run: config.maxTotalModelTokensPerRun,
    max_wall_time_seconds_per_run: config.maxWallTimeSecondsPerRun,
    max_repair_rounds: config.maxRepairRounds,
    max_repair_rounds_per_claim: config.maxRepairRoundsPerClaim,
  };
}

function createEmptyLedgers() {
  return {
    claims: [],
    sources: [],
    evidence: [],
    lane_results: [],
    search_saturation: [],
    verifier_issues: [],
  };
}

function initializeLedgersFromPlan(plan) {
  const ledgers = createEmptyLedgers();
  const items = arrayify(plan?.key_items_to_verify);
  const fallbackItems = items.length > 0
    ? items
    : [{ item: plan?.report_title || "核心调研问题", type: "data", why_needed: "支撑核心结论" }];
  ledgers.claims = fallbackItems.slice(0, 12).map((item, index) => ({
    claim_id: `CL${index + 1}`,
    claim_text: item.item || item.claim_text || `待核验内容 ${index + 1}`,
    status: "unverified",
    required_evidence: arrayify(item.possible_sources || item.required_evidence).slice(0, 6),
    supporting_evidence_ids: [],
    conflicting_evidence_ids: [],
    missing_items: [],
    type: item.type || "",
    why_needed: item.why_needed || "",
    may_need_estimation: Boolean(item.may_need_estimation),
  }));
  return ledgers;
}

function buildResearchLanes(run, task) {
  const claimIds = arrayify(run.ledgers?.claims).map((claim) => claim.claim_id).slice(0, 8);
  const lane = {
    lane_id: "L1",
    phase: "direct_evidence",
    objective: task.topic || run.prompt || "核心直接证据检索",
    claim_ids: claimIds.length > 0 ? claimIds : ["CL1"],
    included_scope: arrayify(task.source_targets).slice(0, 6),
    excluded_scope: [],
    known_sources: [],
    success_criteria: [task.success_criteria || "找到正文可读、口径匹配、可追溯的直接证据。"],
    budget: {
      max_search_calls: config.maxSearchRounds,
      max_results: config.tavilyMaxResults,
      max_body_reads: config.maxSourcesToJudgePerRound,
      max_runtime_seconds: config.maxWallTimeSecondsPerRun,
    },
  };
  return [lane].slice(0, config.maxResearchLanes);
}

function ingestRoundIntoLedgers(run, lane, result) {
  run.ledgers ||= createEmptyLedgers();
  const newSourceIds = [];
  const newEvidenceIds = [];
  const updatedClaimIds = new Set();
  const primaryClaimIds = arrayify(lane?.claim_ids).length > 0
    ? arrayify(lane.claim_ids)
    : arrayify(run.ledgers.claims).map((claim) => claim.claim_id).slice(0, 1);

  for (const source of arrayify(result.sources)) {
    const sourceCard = upsertSourceCard(run, source, primaryClaimIds);
    if (sourceCard.wasNew) newSourceIds.push(sourceCard.source_id);
    if (sourceCard.support_level !== "irrelevant") {
      const evidenceCard = upsertEvidenceCard(run, source, sourceCard, primaryClaimIds);
      if (evidenceCard?.wasNew) newEvidenceIds.push(evidenceCard.evidence_id);
      for (const claimId of primaryClaimIds) {
        const claim = run.ledgers.claims.find((item) => item.claim_id === claimId);
        if (!claim) continue;
        if (evidenceCard && !claim.supporting_evidence_ids.includes(evidenceCard.evidence_id)) {
          claim.supporting_evidence_ids.push(evidenceCard.evidence_id);
          claim.status = claim.status === "supported" ? "supported" : "partially_supported";
          updatedClaimIds.add(claimId);
        }
      }
    }
  }

  return {
    new_source_ids: newSourceIds,
    new_evidence_ids: newEvidenceIds,
    updated_claim_ids: [...updatedClaimIds],
  };
}

function upsertSourceCard(run, source, claimIds) {
  const canonicalUrl = canonicalizeUrlForDedupe(source.url);
  let card = run.ledgers.sources.find((item) => item.canonical_url === canonicalUrl);
  const supportLevel = inferSupportLevel(source);
  if (card) {
    card.supports_claim_ids = [...new Set([...card.supports_claim_ids, ...claimIds])];
    card.title ||= source.title || "";
    card.body_read ||= Boolean(source.extracted);
    card.evidence_summary ||= summarizeText(source.snippet || source.title || "", 360);
    card.content_char_count ||= source.content_char_count || 0;
    card.chunk_count ||= source.chunk_count || 0;
    card.source_artifact_path ||= source.source_artifact_path || "";
    card.source_text_path ||= source.source_text_path || "";
    source.source_id = card.source_id;
    return { ...card, wasNew: false };
  }
  card = {
    source_id: `S${run.ledgers.sources.length + 1}`,
    title: source.title || "",
    url: source.url,
    canonical_url: canonicalUrl,
    publisher: source.publisher || getUrlHost(source.url),
    source_type: normalizeSourceType(source.sourceType),
    source_level: inferSourceLevel(source),
    retrieved_at: todayISO(),
    published_at: source.published_at || "",
    body_read: Boolean(source.extracted),
    raw_artifact_path: source.raw_artifact_path || "",
    source_artifact_id: source.source_artifact_id || "",
    source_artifact_path: source.source_artifact_path || "",
    source_text_path: source.source_text_path || "",
    content_char_count: source.content_char_count || 0,
    chunk_count: source.chunk_count || 0,
    original_source: {
      original_source_id: "",
      original_url: canonicalUrl,
      is_reprint: false,
      cited_by: [],
    },
    supports_claim_ids: [...new Set(claimIds)],
    support_level: supportLevel,
    evidence_summary: summarizeText(source.snippet || source.title || "", 360),
    limitations: source.extracted ? [] : ["未获得网页正文，仅保留搜索摘要或标题线索。"],
  };
  run.ledgers.sources.push(card);
  source.source_id = card.source_id;
  return { ...card, wasNew: true };
}

function upsertEvidenceCard(run, source, sourceCard, claimIds) {
  if (!source?.snippet && !source?.title) return null;
  const existing = run.ledgers.evidence.find((item) => item.source_id === sourceCard.source_id);
  if (existing) return { ...existing, wasNew: false };
  const excerpt = buildEvidenceExcerptFromSource(source, buildFocusTerms(run, { claimIds }));
  const evidence = {
    evidence_id: `E${run.ledgers.evidence.length + 1}`,
    source_id: sourceCard.source_id,
    claim_ids: [...new Set(claimIds)],
    original_text_excerpt: excerpt.text,
    excerpt_location: {
      page: null,
      chunk_id: excerpt.locations[0]?.chunk_id || "",
      char_start: excerpt.locations[0]?.char_start ?? null,
      char_end: excerpt.locations[0]?.char_end ?? null,
    },
    excerpt_locations: excerpt.locations,
    data: {
      value: null,
      unit: "",
      currency: "",
      period: source.published_at || "",
      region: "",
      entity: "",
    },
    method: source.extracted ? "disclosure" : "background",
    support_level: sourceCard.support_level,
    limitations: sourceCard.limitations,
  };
  run.ledgers.evidence.push(evidence);
  return { ...evidence, wasNew: true };
}

function buildLaneResult(lane, result, ledgerUpdate) {
  const recommendedAction = result.error
    ? { action: "targeted_repair", focus: "本轮搜索失败，需检查 API 或更换查询。" }
    : result.saturation?.saturated
      ? { action: "switch_to_decomposition", focus: "直接证据搜索接近饱和，进入缺口处理或推算门禁。" }
      : { action: result.sources.length > 0 ? "continue_direct_search" : "targeted_repair", focus: arrayify(result.parsed?.suggest_next_queries)[0] || "继续定向补搜缺失项。" };
  const laneResult = {
    lane_id: lane?.lane_id || "L1",
    status: result.error ? "failed" : "completed",
    searched_focus: [result.parsed?.query_log?.[0] || lane?.objective || ""].filter(Boolean),
    new_source_ids: ledgerUpdate.new_source_ids,
    new_evidence_ids: ledgerUpdate.new_evidence_ids,
    updated_claim_ids: ledgerUpdate.updated_claim_ids,
    conflicts: [],
    unresolved_gaps: arrayify(result.parsed?.missing_after_this_round),
    recommended_next_action: recommendedAction,
    budget_used: {
      search_calls: summarizeToolCalls(result.raw).webSearch,
      body_reads: result.sources.filter((source) => source.extracted).length,
      tavily_credits: result.raw?.usage?.credits ?? 0,
      runtime_seconds: null,
    },
  };
  return laneResult;
}

function computeSearchSaturation(taskResult) {
  const rounds = arrayify(taskResult.rounds);
  const current = rounds.at(-1);
  if (!current) return null;
  const previousSources = rounds.slice(0, -1).flatMap((round) => arrayify(round.sources));
  const previousUrls = new Set(previousSources.map((source) => canonicalizeUrlForDedupe(source.url)));
  const previousOriginals = new Set(previousSources.map((source) => originalSourceKey(source)));
  const currentSources = arrayify(current.sources);
  const currentCount = currentSources.length || 1;
  const newSources = currentSources.filter((source) => !previousUrls.has(canonicalizeUrlForDedupe(source.url)));
  const newOriginals = currentSources.filter((source) => !previousOriginals.has(originalSourceKey(source)));
  const duplicateOrReprintRate = 1 - (newSources.length / currentCount);
  const newDirectEvidenceCount = newSources.filter((source) => source.extracted && ["S", "A"].includes(inferSourceLevel(source))).length;
  const highQualitySourceCountDelta = newSources.filter((source) => ["S", "A", "B"].includes(inferSourceLevel(source))).length;
  const metrics = {
    direct_search_rounds_used: rounds.length,
    new_direct_evidence_count: newDirectEvidenceCount,
    new_url_rate: roundNumber(newSources.length / currentCount),
    new_original_source_rate: roundNumber(newOriginals.length / currentCount),
    new_claim_coverage_count: newDirectEvidenceCount,
    duplicate_or_reprint_rate: roundNumber(duplicateOrReprintRate),
    high_quality_source_count_delta: highQualitySourceCountDelta,
  };
  const anyTwo = [
    metrics.new_url_rate < 0.2,
    metrics.new_original_source_rate < 0.2,
    metrics.new_claim_coverage_count === 0,
    metrics.duplicate_or_reprint_rate > 0.6,
    metrics.high_quality_source_count_delta === 0,
  ].filter(Boolean).length >= 2;
  const saturated = metrics.direct_search_rounds_used >= config.maxSearchRounds
    && metrics.new_direct_evidence_count === 0
    && anyTwo;
  const result = {
    ...metrics,
    saturated,
    allowed_next_actions: saturated ? ["switch_to_decomposition", "degrade_to_unknown", "write_with_gap"] : [],
  };
  taskResult.saturation = result;
  return result;
}

function applySearchSaturationToDecision(decision, saturation) {
  if (!decision || !saturation?.saturated) return decision;
  return {
    ...decision,
    reason: `${decision.reason || "证据不足"}；搜索饱和规则触发，继续宽泛搜索的边际收益较低。`,
    saturated: true,
    allowed_next_actions: saturation.allowed_next_actions,
  };
}

function getBudgetStopReason(run) {
  if (!run?.budget) return "";
  if (run.budget.stopReason) return run.budget.stopReason;
  const elapsedSeconds = Math.floor((Date.now() - run.budget.startedAt) / 1000);
  if (run.budget.tavilyCreditsUsed >= config.maxTavilyCreditsPerRun) return `达到 Tavily Credit 上限 ${config.maxTavilyCreditsPerRun}`;
  if (run.budget.modelCallsUsed >= config.maxModelCallsPerRun) return `达到模型调用次数上限 ${config.maxModelCallsPerRun}`;
  if (run.budget.totalModelTokensUsed >= config.maxTotalModelTokensPerRun) return `达到模型 Token 上限 ${config.maxTotalModelTokensPerRun}`;
  if (elapsedSeconds >= config.maxWallTimeSecondsPerRun) return `达到运行耗时上限 ${config.maxWallTimeSecondsPerRun}s`;
  if (run.budget.repairRoundsUsed >= config.maxRepairRounds && run.searchDecision?.sufficient === false) return `达到返工轮次上限 ${config.maxRepairRounds}`;
  return "";
}

function markBudgetStop(run, reason) {
  run.budget.stopReason = reason;
  run.budgetStopReason = reason;
}

function buildBudgetStopDecision(run, reason, round) {
  return {
    sufficient: false,
    reason: `预算停止：${reason}`,
    needed_next_queries: [],
    needed_items: ["预算已达上限，需输出当前证据缺口，禁止继续自动搜索或调用模型。"],
    round,
    budget_stop: true,
  };
}

function registerRepairRound(run, decision) {
  run.budget.repairRoundsUsed += 1;
  const issueClaimIds = arrayify(decision?.verifier_issues).map((issue) => issue.claim_id).filter(Boolean);
  const claimIds = issueClaimIds.length > 0 ? issueClaimIds : arrayify(run.ledgers?.claims).map((claim) => claim.claim_id).slice(0, 1);
  for (const claimId of claimIds) {
    run.budget.repairRoundsByClaim[claimId] = (run.budget.repairRoundsByClaim[claimId] || 0) + 1;
  }
}

function canRunRepairRound(run, decision) {
  if (decision?.sufficient) return false;
  if (run.budget.repairRoundsUsed >= config.maxRepairRounds) return false;
  const issues = arrayify(decision?.verifier_issues);
  for (const issue of issues) {
    if (!issue.claim_id) continue;
    if ((run.budget.repairRoundsByClaim[issue.claim_id] || 0) >= config.maxRepairRoundsPerClaim) {
      return false;
    }
  }
  return true;
}

function updateModelBudget(run, usage) {
  if (!run?.budget) return;
  run.budget.modelCallsUsed += 1;
  run.budget.totalModelTokensUsed += Number(usage?.total_tokens || 0);
}

function updateToolBudget(run, provider, metadata) {
  if (!run?.budget || provider !== "tavily") return;
  const credits = Number.isFinite(Number(metadata?.credits))
    ? Number(metadata.credits)
    : estimateTavilyCredits();
  run.budget.tavilyCreditsUsed += credits;
}

function estimateTavilyCredits() {
  return config.tavilySearchDepth === "advanced" ? 2 : 1;
}

function normalizeVerifierIssues(value) {
  return arrayify(value).slice(0, 12).map((issue) => {
    const issueType = allowedVerifierIssueTypes.has(issue.issue_type) ? issue.issue_type : "unsupported_claim";
    const action = issue.required_action && typeof issue.required_action === "object"
      ? issue.required_action
      : { action_type: "targeted_repair_search", query_focus: String(issue.required_action || issue.reason || "") };
    const actionType = allowedRepairActions.has(action.action_type) ? action.action_type : "targeted_repair_search";
    return {
      claim_id: issue.claim_id || "",
      issue_type: issueType,
      reason: summarizeText(issue.reason || "", 260),
      severity: ["low", "medium", "high"].includes(issue.severity) ? issue.severity : "medium",
      required_action: {
        action_type: actionType,
        query_focus: summarizeText(action.query_focus || "", 220),
        allowed_scope: arrayify(action.allowed_scope).slice(0, 6),
        forbidden_scope: arrayify(action.forbidden_scope).slice(0, 6),
        max_repair_rounds: Math.min(toInt(action.max_repair_rounds, config.maxRepairRoundsPerClaim), config.maxRepairRoundsPerClaim),
      },
    };
  });
}

function canonicalizeUrlForDedupe(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|spm|from|source|ref|fbclid|gclid)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return String(url || "").trim();
  }
}

function originalSourceKey(source) {
  return source?.original_source?.original_url || source?.canonical_url || canonicalizeUrlForDedupe(source?.url);
}

function normalizeSourceType(value) {
  const normalized = String(value || "other").toLowerCase();
  if (/official|官网|公告|document/.test(normalized)) return "official_disclosure";
  if (/regulatory|监管|gov/.test(normalized)) return "regulatory";
  if (/financial|财报|earning|annual/.test(normalized)) return "financial_report";
  if (/media|news|新闻/.test(normalized)) return "media";
  if (/research|report|研报/.test(normalized)) return "research_report";
  if (/bidding|招标|中标|采购/.test(normalized)) return "bidding";
  if (/community|论坛|developer/.test(normalized)) return "community";
  return "other";
}

function inferSupportLevel(source) {
  if (!source?.url) return "irrelevant";
  if (source.extracted && ["S", "A"].includes(inferSourceLevel(source))) return "direct";
  if (source.extracted) return "partial";
  if (source.snippet || source.title) return "background";
  return "irrelevant";
}

function roundNumber(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

async function judgeSources(run, userNotes, context) {
  const searchContext = buildSearchContextPack(run, { stage: "source_judge", context });
  const readbacks = [];
  let latest = { response: null, text: "", parsed: null };
  for (let attempt = 0; attempt <= config.maxContextReadRoundsPerStage; attempt += 1) {
    const input = buildJudgeInput(run, userNotes, context, searchContext, readbacks, attempt > 0);
    const response = await callTextModel({
      run,
      stage: attempt === 0 ? "source_judge" : `source_judge_readback_${attempt}`,
      model: modelForRun(run, config.judgeModel),
      system: prompts.base,
      input,
      maxTokens: config.judgeMaxOutputTokens,
      temperature: 0.05,
    });
    const text = getOutputText(response);
    const parsed = parseJsonLoose(text);
    latest = { response, text, parsed };
    const requests = normalizeContextRequests(parsed?.context_requests);
    if (requests.length === 0 || attempt >= config.maxContextReadRoundsPerStage) break;
    const readback = resolveContextRequests(run, requests, {
      stage: "source_judge",
      focusTerms: searchContext.focus_terms,
      charBudget: Math.floor(config.sourceJudgeContextBudgetChars / 2),
    });
    readbacks.push(readback);
    await auditRunEvent(run, "context_readback", {
      stage: "source_judge",
      attempt: attempt + 1,
      requested: requests.length,
      returned: readback.results.length,
      chars: readback.char_count,
    });
  }
  return {
    raw: latest.response,
    text: latest.text,
    parsed: normalizeJudge(latest.parsed, searchContext),
  };
}

function buildJudgeInput(run, userNotes, context, searchContext, readbacks, finalRequired) {
  return [
    prompts.sourceJudge,
    "# 用户原始需求",
    run.prompt,
    "# 用户确认或补充",
    userNotes || "无",
    "# 已确认计划摘要",
    JSON.stringify(buildPlanBrief(run.plan)),
    "# 当前判断轮次",
    JSON.stringify(context || {}),
    "# 搜索上下文包",
    JSON.stringify(searchContext),
    readbacks.length > 0 ? "# 按需回读结果" : "",
    readbacks.length > 0 ? JSON.stringify(readbacks) : "",
    finalRequired ? "# 本轮要求\n必须基于搜索上下文包和按需回读结果输出最终 JSON，不要继续请求上下文。" : "",
    "# 当前日期",
    todayISO(),
  ].filter(Boolean).join("\n\n");
}

async function extractAndScore(run, userNotes, context) {
  const searchContext = buildSearchContextPack(run, { stage: "extract", context });

  const input = [
    prompts.extractScore,
    "# 用户原始需求",
    run.prompt,
    "# 用户确认或补充",
    userNotes || "无",
    "# 已确认计划摘要",
    JSON.stringify(buildPlanBrief(run.plan)),
    "# 当前核验轮次",
    JSON.stringify(context || {}),
    "# 搜索上下文包",
    JSON.stringify(searchContext),
    "# 当前日期",
    todayISO(),
  ].join("\n\n");

  const response = await callTextModel({
    run,
    stage: "extract",
    model: modelForRun(run, config.extractModel),
    system: prompts.base,
    input,
    maxTokens: config.extractMaxOutputTokens,
    temperature: 0.1,
  });
  const text = getOutputText(response);
  return {
    raw: response,
    text,
    parsed: normalizeExtraction(parseJsonLoose(text), searchContext),
  };
}

async function synthesizeReports(run, userNotes) {
  const evidenceBrief = buildExtractionBrief(run.extraction?.parsed || {});
  const readbacks = [];
  let latest = { response: null, text: "", parsed: null };
  for (let attempt = 0; attempt <= config.maxContextReadRoundsPerStage; attempt += 1) {
    const input = buildSynthesisInput(run, userNotes, evidenceBrief, readbacks, attempt > 0);
    const response = await callTextModel({
      run,
      stage: attempt === 0 ? "synthesize" : `synthesize_readback_${attempt}`,
      model: modelForRun(run, config.synthesizeModel),
      system: prompts.base,
      input,
      maxTokens: config.synthesizeMaxOutputTokens,
      temperature: 0.25,
    });
    const text = getOutputText(response);
    const parsed = parseJsonLoose(text);
    latest = { response, text, parsed };
    if (parsed?.research_report_md && parsed?.verification_report_md) break;
    const requests = normalizeContextRequests(parsed?.context_requests);
    if (requests.length === 0 || attempt >= config.maxContextReadRoundsPerStage) break;
    const readback = resolveContextRequests(run, requests, {
      stage: "synthesize",
      focusTerms: buildFocusTerms(run, evidenceBrief),
      charBudget: config.synthesizeReadbackBudgetChars,
    });
    readbacks.push(readback);
    await auditRunEvent(run, "context_readback", {
      stage: "synthesize",
      attempt: attempt + 1,
      requested: requests.length,
      returned: readback.results.length,
      chars: readback.char_count,
    });
  }
  const parsed = normalizeSynthesis(latest.parsed, latest.text, run);
  return { raw: latest.response, text: latest.text, parsed };
}

function buildSynthesisInput(run, userNotes, evidenceBrief, readbacks, finalRequired) {
  return [
    prompts.synthesize,
    "# 用户原始需求",
    run.prompt,
    "# 用户确认或补充",
    userNotes || "无",
    "# 已确认计划摘要",
    JSON.stringify(buildPlanBrief(run.plan)),
    "# 核验证据",
    JSON.stringify(evidenceBrief),
    readbacks.length > 0 ? "# 按需回读结果" : "",
    readbacks.length > 0 ? JSON.stringify(readbacks) : "",
    finalRequired ? "# 本轮要求\n必须基于核验证据和按需回读结果输出最终两份 Markdown 的 JSON，不要继续请求上下文。" : "",
  ].filter(Boolean).join("\n\n");
}

function resolveRequestedTextModel(requestedModel) {
  const value = String(requestedModel || "").trim();
  if (!value) return config.planModel;
  const matched = modelOptions.find((option) => option.value === value || option.label === value);
  return matched?.value || config.planModel;
}

function modelForRun(run, fallback) {
  return run?.model || fallback;
}

async function persistArtifacts(run) {
  const runDir = join(OUTPUT_DIR, run.id);
  await mkdir(runDir, { recursive: true });
  await persistRunState(run, "artifacts_persisting");
  const research = run.synthesis.parsed.research_report_md;
  const verification = run.synthesis.parsed.verification_report_md;
  await writeFile(join(runDir, "research_report.md"), research, "utf8");
  await writeFile(join(runDir, "verification_report.md"), verification, "utf8");
  run.artifacts = [
    {
      name: "research_report.md",
      label: "正式报告",
      path: `/api/artifacts/${run.id}/research_report.md`,
      bytes: Buffer.byteLength(research),
    },
    {
      name: "verification_report.md",
      label: "核验报告",
      path: `/api/artifacts/${run.id}/verification_report.md`,
      bytes: Buffer.byteLength(verification),
    },
  ];
  try {
    const auditPath = join(runDir, "audit.jsonl");
    const auditStat = await stat(auditPath);
    run.artifacts.push({
      name: "audit.jsonl",
      label: "运行日志",
      path: `/api/artifacts/${run.id}/audit.jsonl`,
      bytes: auditStat.size,
    });
  } catch {
    // Audit log is best-effort; report artifacts should still be available.
  }
  for (const name of ["state.json", "ledgers.json"]) {
    try {
      const filePath = join(runDir, name);
      const fileStat = await stat(filePath);
      run.artifacts.push({
        name,
        label: name === "state.json" ? "运行状态" : "证据账本",
        path: `/api/artifacts/${run.id}/${name}`,
        bytes: fileStat.size,
      });
    } catch {
      // State artifacts are best-effort.
    }
  }
  try {
    const filePath = join(runDir, "source_index.json");
    const fileStat = await stat(filePath);
    run.artifacts.push({
      name: "source_index.json",
      label: "来源索引",
      path: `/api/artifacts/${run.id}/source_index.json`,
      bytes: fileStat.size,
    });
  } catch {
    // Source index is best-effort and only exists after search execution.
  }
}

async function persistRunState(run, stage) {
  if (!run?.id) return;
  await ensureRunDir(run);
  const state = {
    run_id: run.id,
    stage,
    prompt: run.prompt,
    mode: run.mode,
    model: run.model,
    created_at: run.createdAt,
    updated_at: new Date().toISOString(),
    budget: run.budget || null,
    budget_limits: buildBudgetLimits(),
    budget_stop_reason: run.budgetStopReason || "",
    research_lanes: run.researchLanes || [],
    search_decision: run.searchDecision || null,
    searches: run.searches.map((taskResult) => ({
      task: taskResult.task,
      lane: taskResult.lane,
      saturation: taskResult.saturation || null,
      rounds: taskResult.rounds.map((round) => ({
        round: round.round,
        lane_id: round.lane?.lane_id || taskResult.lane?.lane_id || "L1",
        error: round.error || "",
        source_count: round.sources?.length || 0,
        query_log: round.parsed?.query_log || [],
        lane_result: round.laneResult || null,
        saturation: round.saturation || null,
      })),
    })),
  };
  await writeFile(join(getRunDir(run), "state.json"), JSON.stringify(state, null, 2), "utf8");
  await writeFile(join(getRunDir(run), "ledgers.json"), JSON.stringify(run.ledgers || createEmptyLedgers(), null, 2), "utf8");
  await persistSourceIndex(run);
}

async function persistSourceIndex(run) {
  if (!run?.id) return;
  const sourceIndex = {
    run_id: run.id,
    updated_at: new Date().toISOString(),
    context_policy: {
      strategy: "offload_context_not_compress",
      chunk_chars: config.sourceChunkChars,
      chunk_overlap_chars: config.sourceChunkOverlapChars,
    },
    sources: arrayify(run.ledgers?.sources).map((source) => ({
      source_id: source.source_id,
      title: source.title || "",
      url: source.url,
      canonical_url: source.canonical_url,
      publisher: source.publisher,
      source_level: source.source_level,
      support_level: source.support_level,
      retrieved_at: source.retrieved_at,
      published_at: source.published_at,
      body_read: source.body_read,
      content_char_count: source.content_char_count || 0,
      chunk_count: source.chunk_count || 0,
      evidence_summary: source.evidence_summary || "",
      raw_artifact_path: source.raw_artifact_path || "",
      source_artifact_path: source.source_artifact_path || "",
      source_text_path: source.source_text_path || "",
      supports_claim_ids: arrayify(source.supports_claim_ids),
      limitations: arrayify(source.limitations),
    })),
  };
  await writeFile(join(getRunDir(run), "source_index.json"), JSON.stringify(sourceIndex, null, 2), "utf8");
}

async function callTextModel({ run, stage, model, system, input, temperature, maxTokens }) {
  if (stage !== "plan") {
    const stopReason = getBudgetStopReason(run);
    if (stopReason) {
      markBudgetStop(run, stopReason);
      await auditRunEvent(run, "budget_stop", { stage, reason: stopReason, budget: run.budget });
      throw new Error(`预算停止：${stopReason}`);
    }
  }
  const endpoint = `${config.textBaseUrl.replace(/\/$/, "")}/chat/completions`;
  const effectiveSystem = system || prompts.base;
  const body = {
    model,
    messages: [
      { role: "system", content: effectiveSystem },
      { role: "user", content: input },
    ],
    temperature,
    max_tokens: maxTokens || config.textMaxOutputTokens,
  };

  let response;
  let networkError;
  const startedAt = Date.now();
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.textApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.textTimeoutMs),
      });
      break;
    } catch (error) {
      networkError = error;
      if (attempt < 2 && shouldRetryNetworkError(error)) {
        await sleep(1600);
      } else {
        break;
      }
    }
  }

  if (!response) {
    await auditModelCall({
      run,
      provider: "siliconflow",
      stage,
      model,
      system: effectiveSystem,
      input,
      requestBody: body,
      status: "network_error",
      error: networkError?.message || "fetch failed",
      startedAt,
    });
    throw new Error(`硅基流动 API 网络调用失败：${networkError?.message || "fetch failed"}`);
  }

  const data = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || JSON.stringify(data).slice(0, 500);
    await auditModelCall({
      run,
      provider: "siliconflow",
      stage,
      model,
      system: effectiveSystem,
      input,
      requestBody: body,
      responseData: data,
      outputText: "",
      usage: data?.usage,
      status: "http_error",
      httpStatus: response.status,
      error: message,
      startedAt,
    });
    throw new Error(`硅基流动 API 调用失败：${response.status} ${message}`);
  }

  const outputText = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || "";
  await auditModelCall({
    run,
    provider: "siliconflow",
    stage,
    model,
    system: effectiveSystem,
    input,
    requestBody: body,
    responseData: data,
    outputText,
    usage: data?.usage,
    status: "ok",
    startedAt,
  });
  return {
    ...data,
    output_text: outputText,
  };
}

function getRunDir(run) {
  return join(OUTPUT_DIR, run.id);
}

async function ensureRunDir(run) {
  await mkdir(getRunDir(run), { recursive: true });
}

function nextAuditSeq(run) {
  run.auditSeq = (run.auditSeq || 0) + 1;
  return String(run.auditSeq).padStart(4, "0");
}

async function auditRunEvent(run, event, payload = {}) {
  if (!run?.id) return;
  await ensureRunDir(run);
  const record = {
    at: new Date().toISOString(),
    runId: run.id,
    event,
    ...payload,
  };
  await appendFile(join(getRunDir(run), "audit.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

async function auditModelCall({
  run,
  provider,
  stage,
  model,
  system,
  input,
  requestBody,
  responseData,
  outputText = "",
  usage,
  status,
  httpStatus,
  error,
  toolCalls,
  startedAt,
}) {
  const durationMs = Date.now() - startedAt;
  logModelUsage({ provider, stage, model, system, input, outputText, usage, startedAt });
  if (!run?.id) return;

  await ensureRunDir(run);
  const seq = nextAuditSeq(run);
  const slug = `${seq}-${safeFilePart(stage || "unknown")}-${safeFilePart(provider || "model")}`;
  const promptFile = `${slug}-prompt.txt`;
  const requestFile = `${slug}-request.json`;
  const responseFile = `${slug}-response.json`;

  await writeFile(join(getRunDir(run), promptFile), [
    "# system",
    system || "",
    "",
    "# user",
    input || "",
  ].join("\n"), "utf8");
  await writeFile(join(getRunDir(run), requestFile), JSON.stringify(requestBody || {}, null, 2), "utf8");
  if (responseData !== undefined) {
    await writeFile(join(getRunDir(run), responseFile), JSON.stringify(responseData, null, 2), "utf8");
  }

  const record = {
    at: new Date().toISOString(),
    runId: run.id,
    event: "model_call",
    provider,
    stage,
    model,
    status,
    httpStatus,
    error,
    durationMs,
    promptBytes: Buffer.byteLength([system, input].filter(Boolean).join("\n\n"), "utf8"),
    outputBytes: Buffer.byteLength(String(outputText || ""), "utf8"),
    usage: normalizeUsage(usage),
    toolCalls: toolCalls || summarizeToolCalls(responseData),
    files: {
      prompt: promptFile,
      request: requestFile,
      response: responseData !== undefined ? responseFile : null,
    },
    filePaths: {
      prompt: `/api/artifacts/${run.id}/${promptFile}`,
      request: `/api/artifacts/${run.id}/${requestFile}`,
      response: responseData !== undefined ? `/api/artifacts/${run.id}/${responseFile}` : null,
    },
  };
  updateModelBudget(run, record.usage);
  await appendFile(join(getRunDir(run), "audit.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

async function auditToolCall({
  run,
  provider,
  stage,
  tool,
  requestBody,
  responseData,
  status,
  httpStatus,
  error,
  startedAt,
  metadata = {},
}) {
  if (!run?.id) return;
  await ensureRunDir(run);
  const seq = nextAuditSeq(run);
  const slug = `${seq}-${safeFilePart(stage || "unknown")}-${safeFilePart(provider || "tool")}-${safeFilePart(tool || "tool")}`;
  const requestFile = `${slug}-request.json`;
  const responseFile = `${slug}-response.json`;
  await writeFile(join(getRunDir(run), requestFile), JSON.stringify(requestBody || {}, null, 2), "utf8");
  if (responseData !== undefined) {
    await writeFile(join(getRunDir(run), responseFile), JSON.stringify(responseData, null, 2), "utf8");
  }

  const record = {
    at: new Date().toISOString(),
    runId: run.id,
    event: "tool_call",
    provider,
    stage,
    tool,
    status,
    httpStatus,
    error,
    durationMs: Date.now() - startedAt,
    ...metadata,
    files: {
      request: requestFile,
      response: responseData !== undefined ? responseFile : null,
    },
    filePaths: {
      request: `/api/artifacts/${run.id}/${requestFile}`,
      response: responseData !== undefined ? `/api/artifacts/${run.id}/${responseFile}` : null,
    },
  };
  updateToolBudget(run, provider, metadata);
  await appendFile(join(getRunDir(run), "audit.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return {};
  return {
    prompt_tokens: usage.prompt_tokens ?? usage.input_tokens ?? null,
    completion_tokens: usage.completion_tokens ?? usage.output_tokens ?? null,
    total_tokens: usage.total_tokens ?? null,
    raw: usage,
  };
}

function summarizeToolCalls(response) {
  const calls = [];
  for (const item of response?.output || []) {
    if (!String(item.type || "").endsWith("_call")) continue;
    const sources = item.action?.sources || item.sources || item.urls || [];
    calls.push({
      type: item.type,
      status: item.status || "",
      query: item.action?.query || item.query || "",
      url: item.action?.url || item.url || item.urls?.[0] || "",
      sourceCount: Array.isArray(sources) ? sources.length : 0,
    });
  }
  return {
    total: calls.length,
    webSearch: calls.filter((item) => item.type === "web_search_call").length,
    calls,
  };
}

function safeFilePart(value) {
  return String(value || "unknown").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "unknown";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryNetworkError(error) {
  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return !name.includes("abort")
    && !name.includes("timeout")
    && !message.includes("aborted")
    && !message.includes("timeout");
}

function normalizeTavilySearchDepth(value) {
  const depth = String(value || "").trim().toLowerCase();
  return ["basic", "advanced", "fast", "ultra-fast"].includes(depth) ? depth : "basic";
}

function getOutputText(response) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }
  const parts = [];
  for (const item of response.output || []) {
    if (item.type === "message") {
      for (const content of item.content || []) {
        if (typeof content.text === "string") parts.push(content.text);
        if (typeof content.output_text === "string") parts.push(content.output_text);
      }
    }
    if (typeof item.text === "string") parts.push(item.text);
  }
  return parts.join("\n").trim();
}

function mergeSources(...groups) {
  const merged = new Map();
  for (const source of groups.flat()) {
    if (!source?.url) continue;
    const previous = merged.get(source.url) || {};
    merged.set(source.url, {
      ...previous,
      ...source,
      title: source.title || previous.title || source.url,
      snippet: source.snippet || previous.snippet || "",
    });
  }
  return [...merged.values()];
}

function parseJsonLoose(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  const candidates = [
    trimmed,
    trimmed.replace(/^```json\s*/i, "").replace(/```$/i, "").trim(),
    repairCommonJsonMistakes(trimmed),
  ];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    candidates.push(fenced[1].trim());
    candidates.push(repairCommonJsonMistakes(fenced[1].trim()));
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function repairCommonJsonMistakes(text) {
  return String(text || "")
    .replace(/},\s*"\{/g, "},{")
    .replace(/\[\s*"\{/g, "[{")
    .replace(/\}"\s*\]/g, "}]");
}

function buildPlanBrief(plan) {
  return {
    report_title: plan?.report_title || "",
    understanding: summarizeText(plan?.understanding || "", 500),
    report_outline: arrayify(plan?.report_outline).slice(0, 6).map((item) => ({
      section: item.section || "",
      purpose: summarizeText(item.purpose || "", 180),
      evidence_needed: arrayify(item.evidence_needed).slice(0, 5),
    })),
    key_items_to_verify: arrayify(plan?.key_items_to_verify).slice(0, 8).map((item) => ({
      item: item.item || "",
      type: item.type || "",
      why_needed: summarizeText(item.why_needed || "", 180),
      may_need_estimation: Boolean(item.may_need_estimation),
    })),
    estimation_plan: arrayify(plan?.estimation_plan).slice(0, 5).map((item) => ({
      target_metric: item.target_metric || "",
      formula_or_logic: summarizeText(item.formula_or_logic || "", 220),
      required_variables: arrayify(item.required_variables).slice(0, 6),
      fallback_rule: summarizeText(item.fallback_rule || "", 180),
    })),
  };
}

function getPrimarySearchTask(plan) {
  const task = arrayify(plan?.search_tasks)[0] || fallbackPlan(plan?.report_title || "").search_tasks[0];
  return {
    task_id: task.task_id || "T1",
    topic: task.topic || plan?.report_title || "核心调研任务",
    report_section: task.report_section || "",
    entities: arrayify(task.entities).slice(0, 8),
    time_range: task.time_range || "截至检索日的最新可得信息",
    source_targets: arrayify(task.source_targets).slice(0, 6),
    information_needed: arrayify(task.information_needed).slice(0, 8),
    data_needed: arrayify(task.data_needed).slice(0, 8),
    success_criteria: summarizeText(task.success_criteria || "", 260),
    initial_queries: arrayify(task.initial_queries).slice(0, 1),
  };
}

function buildTaskBrief(task) {
  return {
    task_id: task.task_id || "T1",
    topic: task.topic || "",
    report_section: task.report_section || "",
    entities: arrayify(task.entities).slice(0, 8),
    time_range: task.time_range || "",
    source_targets: arrayify(task.source_targets).slice(0, 6),
    information_needed: arrayify(task.information_needed).slice(0, 8),
    data_needed: arrayify(task.data_needed).slice(0, 8),
    success_criteria: summarizeText(task.success_criteria || "", 260),
    initial_queries: arrayify(task.initial_queries).slice(0, 1),
  };
}

function buildCompactSearches(run, options = {}) {
  return buildSearchContextPack(run, options);
}

function buildSearchContextPack(run, { stage = "source_judge", context = {} } = {}) {
  const policy = contextPolicyForStage(stage);
  const focusTerms = buildFocusTerms(run, context);
  return {
    context_policy: {
      strategy: "offload_context_not_compress",
      stage,
      source_text_storage: "完整来源正文写入 source-*.json/source-*.txt；上下文只放索引和相关 chunk。",
      chunk_chars: config.sourceChunkChars,
      chunk_overlap_chars: config.sourceChunkOverlapChars,
      max_sources_per_round: policy.maxSourcesPerRound,
      chunks_per_source: policy.chunksPerSource,
      chunks_per_source_policy: policy.chunksPerSourcePolicy,
      max_chunks_per_round: policy.maxChunksPerRound,
      char_budget: policy.charBudget,
      budget_allocation: "按搜索轮次平均分配，避免旧轮次吞掉新轮次上下文。",
    },
    focus_terms: focusTerms.slice(0, 40),
    searches: run.searches.map((taskResult) => ({
      task: buildTaskBrief(taskResult.task),
      lane: taskResult.lane || null,
      rounds: taskResult.rounds.map((round) => {
        const roundBudget = Math.max(
          policy.maxChunkTextChars,
          Math.floor(policy.charBudget / Math.max(1, taskResult.rounds.length)),
        );
        const remaining = { chars: roundBudget };
        let chunksUsed = 0;
        const sources = [];
        const rankedSources = round.sources
          .slice()
          .sort((a, b) => compactSourceScore(b) - compactSourceScore(a))
          .slice(0, policy.maxSourcesPerRound);
        for (const source of rankedSources) {
          const selectedChunks = [];
          if (remaining.chars > 0 && chunksUsed < policy.maxChunksPerRound) {
            const chunks = selectSourceChunks(source, focusTerms, {
              chunksPerSource: chunksPerSourceForStage(source, stage),
              maxChunkTextChars: policy.maxChunkTextChars,
            });
            for (const chunk of chunks) {
              if (chunksUsed >= policy.maxChunksPerRound || remaining.chars <= 0) break;
              const text = summarizeText(chunk.text, Math.min(policy.maxChunkTextChars, remaining.chars));
              if (!text) continue;
              selectedChunks.push({ ...chunk, text });
              remaining.chars -= text.length;
              chunksUsed += 1;
            }
          }
          sources.push(compactSourceCandidate(source, {
            stage,
            contextChunks: selectedChunks,
          }));
        }
        return {
          sources,
          round: round.round,
          error: round.error || "",
          search_summary: summarizeText(round.parsed?.search_summary || round.text || "", 700),
          query_log: arrayify(round.parsed?.query_log).slice(0, 6),
          missing_after_this_round: arrayify(round.parsed?.missing_after_this_round).slice(0, 8),
          suggest_next_queries: arrayify(round.parsed?.suggest_next_queries).slice(0, 6),
          toolCalls: summarizeToolCalls(round.raw),
          lane_result: round.laneResult || null,
          saturation: round.saturation || null,
        };
      }),
      ledgers: {
        claims: arrayify(run.ledgers?.claims).slice(0, 12),
        source_count: arrayify(run.ledgers?.sources).length,
        evidence_count: arrayify(run.ledgers?.evidence).length,
      },
    })),
  };
}

function contextPolicyForStage(stage) {
  const extractLike = stage === "extract";
  return {
    stage,
    maxSourcesPerRound: extractLike
      ? Math.min(config.maxSourcesPerRound, Math.max(config.maxSourcesToJudgePerRound, 10))
      : config.maxSourcesToJudgePerRound,
    chunksPerSource: extractLike ? "S/A:4, B:3, C:2, D:1" : "S/A:3, B:2, C:1, D:1",
    chunksPerSourcePolicy: extractLike
      ? { S: 4, A: 4, B: 3, C: 2, D: 1 }
      : { S: 3, A: 3, B: 2, C: 1, D: 1 },
    maxChunksPerRound: extractLike
      ? Math.min(config.maxContextChunksPerRound * 2, 80)
      : config.maxContextChunksPerRound,
    maxChunkTextChars: extractLike ? config.sourceChunkChars : Math.min(config.sourceChunkChars, 1000),
    charBudget: extractLike ? config.extractContextBudgetChars : config.sourceJudgeContextBudgetChars,
  };
}

function chunksPerSourceForStage(source, stage) {
  const level = inferSourceLevel(source);
  if (stage === "extract") {
    return { S: 4, A: 4, B: 3, C: 2, D: 1 }[level] || 2;
  }
  return { S: 3, A: 3, B: 2, C: 1, D: 1 }[level] || 1;
}

function chunksPerSourceForEvidence(source) {
  return { S: 3, A: 3, B: 2, C: 1, D: 1 }[inferSourceLevel(source)] || 1;
}

function buildEvidenceExcerptFromSource(source, focusTerms) {
  const selectedChunks = selectSourceChunks(source, focusTerms, {
    chunksPerSource: chunksPerSourceForEvidence(source),
    maxChunkTextChars: config.sourceChunkChars,
  });
  if (selectedChunks.length === 0) {
    const fallback = summarizeText(source.snippet || source.title || "", config.synthesizeEvidenceExcerptChars);
    return {
      text: fallback,
      locations: [],
    };
  }

  const parts = [];
  const locations = [];
  let remaining = config.synthesizeEvidenceExcerptChars;
  for (const chunk of selectedChunks) {
    if (remaining <= 0) break;
    const header = `[${chunk.chunk_id || "chunk"} ${chunk.char_start ?? "?"}-${chunk.char_end ?? "?"}] `;
    const available = Math.max(0, remaining - header.length - (parts.length > 0 ? 3 : 0));
    if (available <= 0) break;
    const text = summarizeText(chunk.text || "", available);
    if (!text) continue;
    parts.push(`${header}${text}`);
    locations.push({
      chunk_id: chunk.chunk_id || "",
      char_start: chunk.char_start ?? null,
      char_end: chunk.char_end ?? null,
      relevance_score: chunk.relevance_score ?? null,
    });
    remaining -= header.length + text.length + 3;
  }

  return {
    text: parts.join(" | "),
    locations,
  };
}

function selectSourceChunks(source, focusTerms, { chunksPerSource = 1, maxChunkTextChars = config.sourceChunkChars } = {}) {
  const chunks = arrayify(source?.chunks);
  const fallbackText = source?.snippet || source?.key_snippet || source?.title || "";
  const candidates = chunks.length > 0
    ? chunks
    : fallbackText
      ? [{
          chunk_id: `${source?.source_artifact_id || "source"}-preview`,
          char_start: 0,
          char_end: fallbackText.length,
          text: fallbackText,
        }]
      : [];
  return candidates
    .map((chunk, index) => {
      const relevance = scoreTextAgainstFocus(chunk.text, focusTerms);
      const positionBonus = index === 0 ? 0.8 : 0;
      return {
        chunk_id: chunk.chunk_id || `${source?.source_artifact_id || "source"}-c${index + 1}`,
        char_start: chunk.char_start ?? null,
        char_end: chunk.char_end ?? null,
        relevance_score: roundNumber(relevance + positionBonus),
        text: summarizeText(chunk.text || "", maxChunkTextChars),
      };
    })
    .sort((a, b) => b.relevance_score - a.relevance_score || (a.char_start ?? 0) - (b.char_start ?? 0))
    .slice(0, chunksPerSource)
    .sort((a, b) => (a.char_start ?? 0) - (b.char_start ?? 0));
}

function buildFocusTerms(run, context = {}) {
  const values = [
    run?.prompt || "",
    run?.plan || {},
    run?.searchDecision || {},
    context || {},
  ];
  const terms = [];
  for (const value of values) {
    for (const text of collectTextValues(value)) {
      terms.push(...splitFocusTerms(text));
    }
  }
  return uniqueStrings(terms)
    .filter((term) => term.length >= 2 && term.length <= 60)
    .slice(0, 120);
}

function collectTextValues(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return [];
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => collectTextValues(item, depth + 1));
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([key]) => !/(snippet|full_text|chunks|raw|response|request|artifact_path|text_path)/i.test(key))
      .flatMap(([, item]) => collectTextValues(item, depth + 1));
  }
  return [];
}

function splitFocusTerms(text) {
  const compact = compactWhitespace(text).toLowerCase();
  if (!compact) return [];
  const terms = [];
  if (compact.length <= 60) terms.push(compact);
  const tokens = compact.match(/[a-z0-9][a-z0-9._/-]{1,}|[\u4e00-\u9fff]{2,}/g) || [];
  for (const token of tokens) {
    if (/^[\u4e00-\u9fff]+$/.test(token) && token.length > 6) {
      terms.push(token.slice(0, 12));
      for (let size = 2; size <= 4; size += 1) {
        for (let index = 0; index <= Math.min(token.length - size, 10); index += 1) {
          terms.push(token.slice(index, index + size));
        }
      }
    } else {
      terms.push(token);
    }
  }
  return terms;
}

function scoreTextAgainstFocus(text, focusTerms) {
  const normalized = compactWhitespace(text).toLowerCase();
  if (!normalized) return 0;
  let score = 0;
  for (const term of focusTerms) {
    if (!term || !normalized.includes(term)) continue;
    score += Math.min(12, Math.max(1, term.length / 2));
  }
  const evidenceSignals = normalized.match(/(20\d{2}|19\d{2}|财年|季度|同比|环比|收入|营收|利润|规模|占比|单位|口径|公告|披露|来源|according|reported|revenue|market|share|growth|%|亿元|万美元|billion|million)/gi) || [];
  score += Math.min(12, evidenceSignals.length * 0.8);
  return score;
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const item = String(value || "").trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

function compactSourceScore(source) {
  const level = String(source?.level || source?.likely_level || "").toUpperCase();
  const levelScore = { S: 50, A: 40, B: 30, C: 20, D: 0 }[level] || 10;
  const snippetScore = source?.snippet || source?.key_snippet ? 30 : 0;
  const publisherScore = source?.publisher ? 10 : 0;
  const title = source?.title || "";
  const titleScore = title && title !== source?.url ? 10 : 0;
  return levelScore + snippetScore + publisherScore + titleScore + sourceDomainScore(source?.url);
}

function sourceDomainScore(url) {
  const host = getUrlHost(url);
  if (!host) return 0;
  if (/(^|\.)((sec|gov)\.gov|gov\.cn|hkexnews\.hk)$/.test(host)) return 35;
  if (/(^|\.)(alibabagroup\.com|alibabacloud\.com|aliyun\.com|tencent\.com|tencentcloud\.com|volcengine\.com|bytedance\.com)$/.test(host)) return 32;
  if (/(^|\.)(reuters\.com|bloomberg\.com|ft\.com|wsj\.com|nikkei\.com|36kr\.com|caixin\.com|yicai\.com|datacenterdynamics\.com)$/.test(host)) return 26;
  if (/(^|\.)(rand\.org|worldbank\.org|mckinsey\.com|omdia\.tech)$/.test(host)) return 22;
  if (/(facebook\.com|linkedin\.com|medium\.com|zhihu\.com|binance\.com|ycombinator\.com)$/.test(host)) return -20;
  return 0;
}

function getUrlHost(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function limitSearchSources(sources) {
  if (sources.length <= config.maxSourcesPerRound) return sources;
  const ranked = sources
    .map((source) => ({ ...source, selectionScore: compactSourceScore(source) }))
    .sort((a, b) => b.selectionScore - a.selectionScore);
  const groups = [
    ["alibaba", "aliyun"],
    ["tencent"],
    ["volcano", "volcengine", "bytedance", "byteplus"],
  ];
  const selected = [];
  for (const aliases of groups) {
    const matches = ranked
      .filter((source) => aliases.some((alias) => sourceSearchText(source).includes(alias)))
      .slice(0, 5);
    for (const match of matches) {
      if (!selected.some((source) => source.url === match.url)) selected.push(match);
    }
  }
  for (const candidate of ranked) {
    if (selected.length >= config.maxSourcesPerRound) break;
    if (!selected.some((source) => source.url === candidate.url)) selected.push(candidate);
  }
  return selected.slice(0, config.maxSourcesPerRound);
}

function sourceSearchText(source) {
  return `${source?.url || ""} ${source?.title || ""} ${source?.publisher || ""}`.toLowerCase();
}

function compactSourceCandidate(source, options = {}) {
  const contextChunks = arrayify(options.contextChunks).map((chunk) => ({
    chunk_id: chunk.chunk_id || "",
    char_start: chunk.char_start ?? null,
    char_end: chunk.char_end ?? null,
    relevance_score: chunk.relevance_score ?? null,
    text: chunk.text || "",
  }));
  return {
    source_id: source.source_id || "",
    source_artifact_id: source.source_artifact_id || "",
    title: summarizeText(source.title || source.name || source.url || "", 180),
    url: source.url || source.link || "",
    publisher: source.publisher || "",
    published_at: source.published_at || source.publishedAt || "",
    source_type_guess: source.source_type_guess || source.sourceType || source.type || "",
    likely_level: source.likely_level || source.level || "",
    body_read: Boolean(source.extracted),
    content_char_count: source.content_char_count || 0,
    chunk_count: source.chunk_count || 0,
    source_artifact_path: source.source_artifact_path || "",
    source_text_path: source.source_text_path || "",
    why_relevant: summarizeText(source.why_relevant || "", 220),
    key_snippet: contextChunks[0]?.text || summarizeText(source.key_snippet || source.snippet || "", config.maxSourceExcerptChars),
    context_chunks: contextChunks,
    offload_note: source.source_artifact_path
      ? "完整正文已离线保存；如当前 chunk 不足，只能标记缺口，不得臆造未展示内容。"
      : "",
  };
}

function publicSourceSummary(source) {
  return {
    source_id: source.source_id || "",
    source_artifact_id: source.source_artifact_id || "",
    title: source.title || source.url || "",
    url: source.url || "",
    publisher: source.publisher || "",
    published_at: source.published_at || "",
    level: source.level || inferSourceLevel(source),
    extracted: Boolean(source.extracted),
    content_char_count: source.content_char_count || 0,
    chunk_count: source.chunk_count || 0,
    snippet: summarizeText(source.snippet || "", config.maxSourceExcerptChars),
    source_artifact_path: source.source_artifact_path || "",
    source_text_path: source.source_text_path || "",
    raw_artifact_path: source.raw_artifact_path || "",
  };
}

function buildExtractionBrief(parsed) {
  return {
    evidence: arrayify(parsed.evidence).slice(0, 30).map((item) => ({
      evidence_id: item.evidence_id || "",
      claim_or_data: summarizeText(item.claim_or_data || "", 260),
      info_type: item.info_type || "",
      original_text: summarizeText(item.original_text || "", config.synthesizeEvidenceExcerptChars),
      zh_translation: summarizeText(item.zh_translation || "", config.synthesizeEvidenceExcerptChars),
      url: item.url || "",
      title: summarizeText(item.title || "", 180),
      publisher: item.publisher || "",
      level: item.level || "",
      score: item.score ?? "",
      score_reason: summarizeText(item.score_reason || "", 260),
      published_at: item.published_at || "",
      event_time: item.event_time || "",
      data_period: item.data_period || "",
      entity: item.entity || "",
      region: item.region || "",
      unit: item.unit || "",
      scope: summarizeText(item.scope || "", 180),
      source_chain: item.source_chain || "",
      source_id: item.source_id || "",
      source_artifact_path: item.source_artifact_path || "",
      source_text_path: item.source_text_path || "",
      chunk_id: item.chunk_id || item.excerpt_location?.chunk_id || "",
      char_start: item.char_start ?? item.excerpt_location?.char_start ?? null,
      char_end: item.char_end ?? item.excerpt_location?.char_end ?? null,
      excerpt_locations: arrayify(item.excerpt_locations).slice(0, 6),
      limitations: summarizeText(item.limitations || "", 220),
    })),
    source_coverage: parsed.source_coverage || {},
    claim_clusters: arrayify(parsed.claim_clusters).slice(0, 20),
    conflicts: arrayify(parsed.conflicts).slice(0, 12),
    missing_data: arrayify(parsed.missing_data).slice(0, 15),
    quality_checks: arrayify(parsed.quality_checks).slice(0, 12),
    search_decision: parsed.search_decision || null,
  };
}

function getSearchDecision(parsed, round) {
  const decision = parsed?.search_decision || {};
  const verifierIssues = normalizeVerifierIssues(decision.verifier_issues || parsed?.verifier_issues);
  if (typeof decision.sufficient === "boolean") {
    return {
      sufficient: decision.sufficient,
      reason: decision.reason || decision.judgment_reason || (decision.sufficient ? "模型判断当前证据足以支撑成稿。" : "模型判断当前证据不足，需要补搜。"),
      needed_next_queries: arrayify(decision.needed_next_queries || decision.next_queries).slice(0, 3),
      needed_items: arrayify(decision.needed_items).slice(0, 8),
      verifier_issues: verifierIssues,
      round,
    };
  }

  const checks = arrayify(parsed?.quality_checks);
  const hasFail = checks.some((item) => item.status === "fail");
  const hasWarn = checks.some((item) => item.status === "warn");
  const evidenceCount = arrayify(parsed?.evidence).length;
  const clusters = arrayify(parsed?.claim_clusters);
  const hasSupportedCluster = clusters.some((item) => ["confirmed", "likely", "partial"].includes(item.status));
  const sufficient = evidenceCount > 0 && !hasFail && (!hasWarn || hasSupportedCluster);
  return {
    sufficient,
    reason: sufficient
      ? "模型未给出显式 search_decision；根据证据数量和质量检查保守判定可以进入成稿。"
      : "模型未给出显式 search_decision；根据证据数量或质量检查判定需要补搜。",
    needed_next_queries: [],
    needed_items: [],
    verifier_issues: verifierIssues,
    round,
  };
}

function normalizePlan(plan) {
  const normalized = plan && typeof plan === "object" ? plan : fallbackPlan("");
  normalized.understanding ||= normalized.underning || normalized.user_understanding || "";
  normalized.report_title ||= "信源核验型行业调研报告";
  normalized.report_outline = Array.isArray(normalized.report_outline) ? normalized.report_outline : [];
  normalized.key_items_to_verify = Array.isArray(normalized.key_items_to_verify) ? normalized.key_items_to_verify : [];
  normalized.search_tasks = Array.isArray(normalized.search_tasks) ? normalized.search_tasks : [];
  normalized.estimation_plan = Array.isArray(normalized.estimation_plan) ? normalized.estimation_plan : [];
  normalized.confirmation_questions = Array.isArray(normalized.confirmation_questions) ? normalized.confirmation_questions : [];
  normalized.quality_checks = Array.isArray(normalized.quality_checks) ? normalized.quality_checks : [];

  normalized.search_tasks = normalized.search_tasks.slice(0, config.maxSearchTasks).map((task, index) => ({
    task_id: task.task_id || `T${index + 1}`,
    topic: task.topic || task.report_section || `搜索任务 ${index + 1}`,
    report_section: task.report_section || "",
    entities: arrayify(task.entities),
    time_range: task.time_range || "截至检索日的最新可得信息",
    source_targets: arrayify(task.source_targets),
    information_needed: arrayify(task.information_needed),
    data_needed: arrayify(task.data_needed),
    success_criteria: task.success_criteria || "",
    initial_queries: arrayify(task.initial_queries).slice(0, 1),
  }));

  if (normalized.search_tasks.length === 0) {
    normalized.search_tasks.push({
      task_id: "T1",
      topic: normalized.report_title,
      report_section: normalized.report_outline[0]?.section || "核心结论",
      entities: [],
      time_range: "截至检索日的最新可得信息",
      source_targets: ["官方/一手来源", "权威第三方", "行业媒体", "线索来源"],
      information_needed: ["关键事实", "关键数据", "关键判断"],
      data_needed: [],
      success_criteria: "至少找到可追溯来源；数据缺失时记录缺口并判断是否可推算。",
      initial_queries: [normalized.report_title],
    });
  }

  return normalized;
}

function getSearchesFromContext(contextPack) {
  if (Array.isArray(contextPack)) return contextPack;
  if (Array.isArray(contextPack?.searches)) return contextPack.searches;
  return [];
}

function getSourceCandidateText(source) {
  const chunkText = arrayify(source?.context_chunks).map((chunk) => chunk.text).filter(Boolean).join("\n");
  return chunkText || source?.key_snippet || source?.snippet || "";
}

function normalizeContextRequests(value) {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [value]
      : arrayify(value).map((item) => ({ query: item }));
  return list
    .slice(0, config.maxContextRequestsPerRound)
    .map((request, index) => {
      const normalized = request && typeof request === "object" ? request : { query: String(request || "") };
      return {
        request_id: normalized.request_id || `CR${index + 1}`,
        source_id: normalized.source_id || "",
        source_artifact_id: normalized.source_artifact_id || "",
        url: normalized.url || "",
        chunk_id: normalized.chunk_id || "",
        char_start: normalized.char_start ?? null,
        char_end: normalized.char_end ?? null,
        query: summarizeText(normalized.query || normalized.reason || normalized.needed_item || "", 240),
        reason: summarizeText(normalized.reason || normalized.needed_item || "", 240),
        max_chunks: Math.min(Math.max(toInt(normalized.max_chunks, 3), 1), 6),
      };
    })
    .filter((request) => request.source_id || request.source_artifact_id || request.url || request.query);
}

function resolveContextRequests(run, requests, { stage, focusTerms = [], charBudget = config.synthesizeReadbackBudgetChars } = {}) {
  const normalizedRequests = normalizeContextRequests(requests);
  const results = [];
  let remaining = charBudget;
  for (const request of normalizedRequests) {
    if (remaining <= 0) break;
    const source = findSourceForContextRequest(run, request);
    if (!source) {
      results.push({
        request_id: request.request_id,
        status: "not_found",
        reason: "未找到匹配 source；只能基于已有上下文处理。",
        request,
      });
      continue;
    }
    const terms = uniqueStrings([
      ...focusTerms,
      ...splitFocusTerms(request.query),
      ...splitFocusTerms(request.reason),
    ]);
    const chunks = selectChunksForContextRequest(source, request, terms)
      .slice(0, request.max_chunks);
    const returnedChunks = [];
    for (const chunk of chunks) {
      if (remaining <= 0) break;
      const maxChars = Math.min(config.maxContextReadCharsPerRequest, remaining);
      const text = summarizeText(chunk.text || "", maxChars);
      if (!text) continue;
      returnedChunks.push({
        chunk_id: chunk.chunk_id || "",
        char_start: chunk.char_start ?? null,
        char_end: chunk.char_end ?? null,
        relevance_score: chunk.relevance_score ?? null,
        text,
      });
      remaining -= text.length;
    }
    results.push({
      request_id: request.request_id,
      status: returnedChunks.length > 0 ? "ok" : "empty",
      stage,
      request,
      source: {
        source_id: source.source_id || "",
        source_artifact_id: source.source_artifact_id || "",
        title: source.title || source.url || "",
        url: source.url || "",
        publisher: source.publisher || "",
        level: source.level || inferSourceLevel(source),
        source_artifact_path: source.source_artifact_path || "",
        source_text_path: source.source_text_path || "",
        content_char_count: source.content_char_count || 0,
        chunk_count: source.chunk_count || 0,
      },
      chunks: returnedChunks,
    });
  }
  return {
    stage,
    strategy: "on_demand_source_readback",
    char_budget: charBudget,
    char_count: charBudget - remaining,
    results,
  };
}

function selectChunksForContextRequest(source, request, focusTerms) {
  const chunks = arrayify(source?.chunks);
  if (request.chunk_id) {
    const matched = chunks.find((chunk) => chunk.chunk_id === request.chunk_id);
    if (matched) return [{ ...matched, relevance_score: 999 }];
  }
  if (request.char_start !== null || request.char_end !== null) {
    const start = Number.isFinite(Number(request.char_start)) ? Number(request.char_start) : 0;
    const end = Number.isFinite(Number(request.char_end)) ? Number(request.char_end) : Number.MAX_SAFE_INTEGER;
    const overlapped = chunks
      .filter((chunk) => (chunk.char_end ?? 0) >= start && (chunk.char_start ?? 0) <= end)
      .map((chunk) => ({ ...chunk, relevance_score: 998 }));
    if (overlapped.length > 0) return overlapped;
  }
  return selectSourceChunks(source, focusTerms, {
    chunksPerSource: request.max_chunks || 3,
    maxChunkTextChars: config.maxContextReadCharsPerRequest,
  });
}

function findSourceForContextRequest(run, request) {
  const sources = getAllRunSources(run);
  if (request.source_id) {
    const matched = sources.find((source) => source.source_id === request.source_id);
    if (matched) return matched;
  }
  if (request.source_artifact_id) {
    const matched = sources.find((source) => source.source_artifact_id === request.source_artifact_id);
    if (matched) return matched;
  }
  if (request.url) {
    const canonical = canonicalizeUrlForDedupe(request.url);
    const matched = sources.find((source) => canonicalizeUrlForDedupe(source.url) === canonical);
    if (matched) return matched;
  }
  if (request.query) {
    const terms = splitFocusTerms(request.query);
    return sources
      .map((source) => ({ source, score: scoreTextAgainstFocus(`${source.title || ""} ${source.url || ""} ${source.publisher || ""} ${source.snippet || ""}`, terms) + compactSourceScore(source) }))
      .sort((a, b) => b.score - a.score)[0]?.source || null;
  }
  return null;
}

function getAllRunSources(run) {
  return mergeSources(
    ...arrayify(run?.searches).flatMap((taskResult) => arrayify(taskResult.rounds).map((round) => arrayify(round.sources))),
  );
}

function normalizeJudge(parsed, compactSearches) {
  if (parsed && typeof parsed === "object") {
    parsed.source_coverage ||= {};
    parsed.quality_checks = Array.isArray(parsed.quality_checks) ? parsed.quality_checks : [];
    parsed.verifier_issues = normalizeVerifierIssues(parsed.verifier_issues || parsed.issues);
    parsed.search_decision = parsed.search_decision && typeof parsed.search_decision === "object"
      ? parsed.search_decision
      : {
          sufficient: false,
          reason: "模型未返回结构化 search_decision，按证据不足处理。",
          needed_next_queries: [],
          needed_items: ["需要人工复核搜索结果是否足以支撑结论。"],
        };
    if (typeof parsed.search_decision.sufficient !== "boolean") {
      parsed.search_decision.sufficient = false;
    }
    parsed.search_decision.needed_next_queries = arrayify(parsed.search_decision.needed_next_queries).slice(0, 3);
    parsed.search_decision.needed_items = arrayify(parsed.search_decision.needed_items).slice(0, 8);
    parsed.search_decision.verifier_issues = parsed.verifier_issues;
    return parsed;
  }

  const searches = getSearchesFromContext(compactSearches);
  const rounds = searches.flatMap((task) => task.rounds || []);
  const sourceCount = rounds.reduce((sum, round) => sum + arrayify(round.sources).length, 0);
  const hasToolCalls = rounds.some((round) => (round.toolCalls?.total || 0) > 0);
  return {
    source_coverage: {
      S: 0,
      A: 0,
      B: 0,
      C: sourceCount,
      D: 0,
      coverage_comment: "轻量判断未返回可解析 JSON，按保守规则处理。",
    },
    quality_checks: [
      {
        check: "轻量判断 JSON",
        status: "warn",
        note: "模型未返回可解析 JSON。",
      },
      {
        check: "真实工具调用",
        status: hasToolCalls ? "pass" : "warn",
        note: hasToolCalls ? "检测到真实 Tavily Search 调用。" : "未检测到真实 Tavily Search 调用。",
      },
    ],
    verifier_issues: [],
    search_decision: {
      sufficient: false,
      reason: "轻量判断失败，按证据不足处理并尝试补搜。",
      needed_next_queries: rounds.flatMap((round) => arrayify(round.suggest_next_queries)).slice(0, 3),
      needed_items: rounds.flatMap((round) => arrayify(round.missing_after_this_round)).slice(0, 8),
    },
  };
}

function normalizeExtraction(parsed, compactSearches) {
  if (parsed && typeof parsed === "object") {
    return enrichParsedExtraction(parsed, compactSearches);
  }
  const sources = getSearchesFromContext(compactSearches)
    .flatMap((task) => task.rounds.flatMap((round) => round.sources || []));
  return {
    evidence: sources.slice(0, 20).map((source, index) => ({
      evidence_id: `E${index + 1}`,
      claim_or_data: source.title,
      info_type: "fact",
      original_text: getSourceCandidateText(source) || source.title,
      zh_translation: getSourceCandidateText(source) || source.title,
      url: source.url,
      title: source.title,
      publisher: source.publisher || "",
      level: source.likely_level || source.level || "C",
      score: { S: 90, A: 80, B: 65, C: 45, D: 0 }[source.likely_level || source.level || "C"] ?? 45,
      score_reason: "模型未能输出结构化核验结果，按搜索结果保守降级处理。",
      published_at: "",
      event_time: "",
      data_period: "",
      original_source_time: "",
      retrieved_at: todayISO(),
      entity: "",
      region: "",
      unit: "",
      currency: "",
      scope: "",
      method: "未知",
      source_chain: "无法追溯",
      source_id: source.source_id || "",
      source_artifact_path: source.source_artifact_path || "",
      chunk_id: source.context_chunks?.[0]?.chunk_id || "",
      char_start: source.context_chunks?.[0]?.char_start ?? null,
      char_end: source.context_chunks?.[0]?.char_end ?? null,
      limitations: "缺少完整结构化抽取，需要人工复核。",
    })),
    source_coverage: { S: 0, A: 0, B: 0, C: sources.length, D: 0, coverage_comment: "结构化抽取失败，已保留搜索来源作为弱证据线索。" },
    claim_clusters: [],
    conflicts: [],
    missing_data: sources.length > 0
      ? []
      : [{ needed_item: "可核验的真实搜索来源", handling: "两轮搜索均未返回真实来源，需检查搜索工具配置或稍后重试。" }],
    quality_checks: [{ check: "结构化抽取", status: "warn", note: "模型未返回可解析 JSON，已生成保守 fallback。" }],
  };
}

function enrichParsedExtraction(parsed, contextPack) {
  const searches = getSearchesFromContext(contextPack);
  const sourceCandidates = searches.flatMap((task) =>
    arrayify(task.rounds).flatMap((round) => arrayify(round.sources)),
  );
  const byUrl = new Map();
  for (const source of sourceCandidates) {
    if (source?.url) byUrl.set(canonicalizeUrlForDedupe(source.url), source);
  }
  const enriched = { ...parsed };
  enriched.evidence = arrayify(parsed.evidence).slice(0, 30).map((item, index) => {
    const source = byUrl.get(canonicalizeUrlForDedupe(item.url)) || null;
    const firstChunk = arrayify(source?.context_chunks)[0] || null;
    const originalText = item.original_text || firstChunk?.text || source?.key_snippet || "";
    return {
      ...item,
      evidence_id: item.evidence_id || `E${index + 1}`,
      original_text: summarizeText(originalText, config.synthesizeEvidenceExcerptChars),
      zh_translation: summarizeText(item.zh_translation || originalText, config.synthesizeEvidenceExcerptChars),
      title: item.title || source?.title || item.url || "",
      publisher: item.publisher || source?.publisher || "",
      level: item.level || source?.likely_level || "C",
      source_id: item.source_id || source?.source_id || "",
      source_artifact_path: item.source_artifact_path || source?.source_artifact_path || "",
      source_text_path: item.source_text_path || source?.source_text_path || "",
      chunk_id: item.chunk_id || firstChunk?.chunk_id || "",
      char_start: item.char_start ?? firstChunk?.char_start ?? null,
      char_end: item.char_end ?? firstChunk?.char_end ?? null,
    };
  });
  enriched.claim_clusters = arrayify(parsed.claim_clusters).slice(0, 20);
  enriched.conflicts = arrayify(parsed.conflicts).slice(0, 12);
  enriched.missing_data = arrayify(parsed.missing_data).slice(0, 15);
  enriched.quality_checks = arrayify(parsed.quality_checks).slice(0, 12);
  return enriched;
}

function buildNoSourceJudgment(result) {
  const reason = result.error
    ? `本轮搜索失败：${result.error}`
    : "本轮未获得任何由真实 Tavily Search 返回的可追溯来源。";
  return {
    raw: null,
    text: "",
    parsed: {
      source_coverage: {
        S: 0,
        A: 0,
        B: 0,
        C: 0,
        D: 0,
        coverage_comment: reason,
      },
      quality_checks: [
        {
          check: "真实搜索来源",
          status: "fail",
          note: reason,
        },
      ],
      search_decision: {
        sufficient: false,
        reason,
      needed_next_queries: arrayify(result.parsed?.suggest_next_queries).slice(0, 3),
        needed_items: arrayify(result.parsed?.missing_after_this_round).slice(0, 8),
      },
    },
  };
}

function buildDeterministicExtraction(run) {
  if (arrayify(run.ledgers?.evidence).length > 0) {
    return buildExtractionFromLedgers(run);
  }

  const sources = mergeSources(
    ...run.searches.flatMap((taskResult) => taskResult.rounds.map((round) => round.sources)),
  )
    .filter((source) => source.url && (source.snippet || (source.title && source.title !== source.url)))
    .sort((a, b) => compactSourceScore(b) - compactSourceScore(a))
    .slice(0, 12);

  const evidence = sources.map((source, index) => {
    const level = inferSourceLevel(source);
    const excerpt = buildEvidenceExcerptFromSource(source, buildFocusTerms(run));
    const text = excerpt.text || summarizeText(source.snippet || source.title || "", config.synthesizeEvidenceExcerptChars);
    return {
      evidence_id: `E${index + 1}`,
      claim_or_data: summarizeText(text || source.title || source.url, 320),
      info_type: "disclosure",
      original_text: text,
      zh_translation: text,
      url: source.url,
      title: source.title || source.url,
      publisher: source.publisher || "",
      level,
      score: { S: 95, A: 85, B: 70, C: 50, D: 0 }[level],
      score_reason: source.snippet
        ? "来源由真实 Web Search 返回，并保留可追溯 URL 与相关正文/摘要片段。"
        : "来源由真实 Web Search 返回，但缺少正文片段，需人工复核。",
      published_at: source.published_at || "",
      event_time: "",
      data_period: "",
      original_source_time: "",
      retrieved_at: todayISO(),
      entity: "",
      region: "",
      unit: "",
      currency: "",
      scope: summarizeText(source.why_relevant || "", 220),
      method: source.extracted ? "披露" : "引用",
      source_chain: level === "S" ? "一手" : "待核验",
      source_id: source.source_id || "",
      source_artifact_path: source.source_artifact_path || "",
      source_text_path: source.source_text_path || "",
      chunk_id: excerpt.locations[0]?.chunk_id || "",
      char_start: excerpt.locations[0]?.char_start ?? null,
      char_end: excerpt.locations[0]?.char_end ?? null,
      excerpt_locations: excerpt.locations,
      limitations: source.snippet ? "" : "未读取网页正文，仅保留搜索来源线索。",
    };
  });

  const coverage = { S: 0, A: 0, B: 0, C: 0, D: 0 };
  for (const item of evidence) coverage[item.level] += 1;
  const missingItems = arrayify(run.searchDecision?.needed_items);

  return {
    raw: null,
    text: "",
    parsed: {
      evidence,
      source_coverage: {
        ...coverage,
        coverage_comment: `基于真实工具返回的 ${evidence.length} 个高相关来源确定性构建；未额外调用完整抽取模型。`,
      },
      claim_clusters: [],
      conflicts: [],
      missing_data: missingItems.map((item) => ({
        needed_item: item,
        search_attempts: "最多两轮真实 Web Search",
        can_estimate: false,
        estimation_logic: "当前证据不足以进行可靠推算。",
        handling: "正式报告中降级表述或标记未知。",
      })),
      search_decision: run.searchDecision || null,
      quality_checks: [
        {
          check: "真实工具来源",
          status: evidence.length > 0 ? "pass" : "fail",
          note: evidence.length > 0 ? "证据均来自真实 Web Search 返回 URL。" : "没有可用证据。",
        },
        {
          check: "网页正文读取",
          status: evidence.some((item) => item.method === "披露") ? "pass" : "warn",
          note: evidence.some((item) => item.method === "披露")
            ? "至少一个关键来源已通过 Tavily Search 的 raw_content 获得清洗后的网页正文。"
            : "未成功读取网页正文，证据仅为搜索摘要。",
        },
      ],
    },
  };
}

function buildExtractionFromLedgers(run) {
  const evidence = arrayify(run.ledgers.evidence).slice(0, 30).map((item) => {
    const source = run.ledgers.sources.find((sourceCard) => sourceCard.source_id === item.source_id) || {};
    const level = source.source_level || "C";
    return {
      evidence_id: item.evidence_id,
      claim_or_data: summarizeText(item.original_text_excerpt || source.evidence_summary || source.url, 320),
      info_type: item.method || "disclosure",
      original_text: summarizeText(item.original_text_excerpt || source.evidence_summary || "", config.synthesizeEvidenceExcerptChars),
      zh_translation: summarizeText(item.original_text_excerpt || source.evidence_summary || "", config.synthesizeEvidenceExcerptChars),
      url: source.url || "",
      title: source.title || source.publisher || source.url || item.source_id,
      publisher: source.publisher || "",
      level,
      score: { S: 95, A: 85, B: 70, C: 50, D: 0 }[level] ?? 50,
      score_reason: "证据来自 Source/Evidence Ledger；来源由后端真实搜索工具返回并按 schema 入账。",
      published_at: source.published_at || "",
      event_time: "",
      data_period: item.data?.period || "",
      original_source_time: "",
      retrieved_at: source.retrieved_at || todayISO(),
      entity: item.data?.entity || "",
      region: item.data?.region || "",
      unit: item.data?.unit || "",
      currency: item.data?.currency || "",
      scope: arrayify(item.claim_ids).join(", "),
      method: item.method === "disclosure" ? "披露" : "引用",
      source_chain: source.original_source?.is_reprint ? "转载/引用链" : "原始或待核验",
      source_id: item.source_id || "",
      source_artifact_path: source.source_artifact_path || "",
      source_text_path: source.source_text_path || "",
      chunk_id: item.excerpt_location?.chunk_id || "",
      char_start: item.excerpt_location?.char_start ?? null,
      char_end: item.excerpt_location?.char_end ?? null,
      excerpt_locations: arrayify(item.excerpt_locations).slice(0, 6),
      limitations: arrayify(item.limitations || source.limitations).join("；"),
    };
  });
  const coverage = { S: 0, A: 0, B: 0, C: 0, D: 0 };
  for (const item of evidence) coverage[item.level] += 1;
  const missingItems = [
    ...arrayify(run.searchDecision?.needed_items),
    ...arrayify(run.ledgers.claims).flatMap((claim) => arrayify(claim.missing_items)),
  ];
  return {
    raw: null,
    text: "",
    parsed: {
      evidence,
      source_coverage: {
        ...coverage,
        coverage_comment: `基于严格 Source/Evidence/Claim Ledger 构建，共 ${evidence.length} 条证据。`,
      },
      claim_clusters: arrayify(run.ledgers.claims).map((claim) => ({
        claim_id: claim.claim_id,
        claim: claim.claim_text,
        status: claim.status,
        evidence_ids: claim.supporting_evidence_ids,
      })),
      conflicts: [],
      missing_data: [...new Set(missingItems)].filter(Boolean).map((item) => ({
        needed_item: item,
        search_attempts: "受控 Research Lane + 最多两轮 Tavily Search",
        can_estimate: false,
        estimation_logic: "当前证据不足以进行可靠推算。",
        handling: "正式报告中降级表述或标记未知。",
      })),
      search_decision: run.searchDecision || null,
      quality_checks: [
        {
          check: "严格账本",
          status: "pass",
          note: "已生成 Source Card、Evidence Card 和 Claim Card。",
        },
        {
          check: "预算与返工约束",
          status: run.budgetStopReason ? "warn" : "pass",
          note: run.budgetStopReason || "未触发硬预算停止。",
        },
      ],
    },
  };
}

function inferSourceLevel(source) {
  const explicit = String(source.level || source.likely_level || "").toUpperCase();
  if (["S", "A", "B", "C", "D"].includes(explicit)) return explicit;
  const host = getUrlHost(source.url);
  if (/cloud\.tencent\.com\/developer\/(news|article)\//.test(String(source.url || ""))) return "B";
  if (sourceDomainScore(source.url) >= 30 || /\.(gov|edu)\.cn$/.test(host) || /wikipedia\.org|baike\.baidu\.com/.test(host)) return "S";
  if (sourceDomainScore(source.url) >= 22) return "A";
  return source.publisher ? "B" : "C";
}

function countActualSources(run) {
  return run.searches.reduce(
    (total, taskResult) => total + taskResult.rounds.reduce((roundTotal, round) => roundTotal + round.sources.length, 0),
    0,
  );
}

function buildEvidenceGapSynthesis(run, reason) {
  const title = run.plan?.report_title || "信源核验型行业调研报告";
  const evidence = arrayify(run.extraction?.parsed?.evidence);
  const missing = arrayify(run.extraction?.parsed?.missing_data);
  const extractedEvidenceCount = evidence.filter((item) => item.method === "披露").length;
  const finalReason = extractedEvidenceCount > 0
    ? `已完成 ${run.searches[0]?.rounds?.length || 0} 轮搜索并读取 ${extractedEvidenceCount} 个关键网页正文；现有来源仍未提供可直接支撑目标结论所需的完整数据、时间与统计口径。`
    : reason;
  const task = run.searches[0]?.task || {};
  const entities = [...new Set(arrayify(task.entities).filter(Boolean))];
  const subjects = entities.length > 0 ? entities : ["用户需求中的目标主体/对象"];
  const sources = mergeSources(
    ...run.searches.flatMap((taskResult) => taskResult.rounds.map((round) => round.sources)),
  ).sort((a, b) => compactSourceScore(b) - compactSourceScore(a));
  const rounds = run.searches.flatMap((taskResult) => taskResult.rounds);
  const toolCalls = rounds.reduce((summary, round) => {
    const calls = summarizeToolCalls(round.raw);
    summary.webSearch += calls.webSearch;
    return summary;
  }, { webSearch: 0 });

  const researchLines = [
    `# ${title}`,
    "",
    "## 执行摘要",
    "",
    `截至 ${todayISO()}，已完成 ${rounds.length} 轮真实联网搜索。当前公开资料不足以可靠支撑用户需求中的完整结论。`,
    "",
    `核验判断：${finalReason}`,
    "",
    "因此，本报告只记录已被来源支持的事实，并把缺少直接证据、时间口径或统计口径的部分标记为未知。",
    "",
    "## 分主体结果",
    "",
    "| 主体/对象 | 已获得的直接证据 | 仍缺少的关键口径 | 当前结论 |",
    "|---|---|---|---|",
    ...subjects.map((entity) =>
      `| ${escapeMarkdownCell(entity)} | 未找到足以完整支撑目标结论的公开可信披露 | 需补充直接披露、时间范围、统计口径和可交叉验证来源 | 只能标记为证据不足，不能可靠给出确定性结论 |`
    ),
    "",
    "## 已确认的公开信息",
    "",
    evidence.length > 0
      ? evidence.map((item) => `- **${item.evidence_id}**${item.source_id ? ` / ${item.source_id}` : ""}${item.chunk_id ? ` / ${item.chunk_id}` : ""} [${escapeMarkdownCell(item.title || item.url)}](${item.url})：${escapeMarkdownCell(summarizeText(item.original_text || item.claim_or_data, 360))}`).join("\n")
      : "未提取到可用于支撑结论的网页正文；真实搜索 URL 和失败原因见核验报告。",
    "",
    "## 仍缺少的关键数据",
    "",
    missing.length > 0
      ? missing.map((item) => `- ${escapeMarkdownCell(item.needed_item || String(item))}`).join("\n")
      : "- 目标结论所需的直接披露、时间范围、统计口径和可交叉验证来源。",
    "",
    "## 结论",
    "",
    "在当前公开资料和最多两轮检索约束下，能可靠得出的结论是：目标问题仍存在关键证据缺口。继续给出确定性判断会构成无证据推断。",
  ];

  const verificationLines = [
    "# 核验报告",
    "",
    "## 执行状态",
    "",
    `- 状态：证据不足，正常结束`,
    `- 原因：${finalReason}`,
    `- 搜索轮次：${rounds.length}`,
    `- Tavily Search 调用：${toolCalls.webSearch}`,
    `- 含清洗网页正文的证据：${extractedEvidenceCount}`,
    `- 真实来源数：${sources.length}`,
    `- 证据条数：${evidence.length}`,
    `- Research Lane 数：${arrayify(run.researchLanes).length}`,
    `- Tavily Credits 已用：${run.budget?.tavilyCreditsUsed ?? 0}/${config.maxTavilyCreditsPerRun}`,
    `- 模型调用已用：${run.budget?.modelCallsUsed ?? 0}/${config.maxModelCallsPerRun}`,
    `- 模型 Token 已用：${run.budget?.totalModelTokensUsed ?? 0}/${config.maxTotalModelTokensPerRun}`,
    run.budgetStopReason ? `- 硬预算停止原因：${run.budgetStopReason}` : "- 硬预算停止原因：未触发",
    "",
    "## 最终判断",
    "",
    finalReason,
    "",
    "## Research Lane 与账本摘要",
    "",
    "```json",
    JSON.stringify({
      lanes: run.researchLanes || [],
      source_count: arrayify(run.ledgers?.sources).length,
      evidence_count: arrayify(run.ledgers?.evidence).length,
      claim_count: arrayify(run.ledgers?.claims).length,
      latest_saturation: run.searches?.[0]?.saturation || run.searches?.[0]?.rounds?.at(-1)?.saturation || null,
      verifier_issues: arrayify(run.ledgers?.verifier_issues),
    }, null, 2),
    "```",
    "",
    "## 证据表",
    "",
    "| ID | Source | Chunk/Offset | 等级 | 来源 | 可支持内容 | 局限 |",
    "|---|---|---|---|---|---|---|",
    ...(evidence.length > 0
      ? evidence.map((item) => `| ${item.evidence_id} | ${escapeMarkdownCell(item.source_id || "-")} | ${escapeMarkdownCell([item.chunk_id, item.char_start ?? "", item.char_end ?? ""].filter((value) => value !== "").join(" / ") || "-")} | ${item.level} / ${item.score} | [${escapeMarkdownCell(item.title || item.url)}](${item.url}) | ${escapeMarkdownCell(summarizeText(item.original_text || item.claim_or_data, 300))} | ${escapeMarkdownCell(item.limitations || "不能据此直接支撑目标结论的完整数据、时间与口径")} |`)
      : ["| - | - | - | - | - | 未获得可支撑结论的正文证据 | - |"]),
    "",
    "## 未找到数据记录",
    "",
    "| 缺失项 | 已执行搜索 | 是否可可靠估算 | 处理方式 |",
    "|---|---|---|---|",
    ...(missing.length > 0
      ? missing.map((item) => `| ${escapeMarkdownCell(item.needed_item || String(item))} | ${escapeMarkdownCell(item.search_attempts || `${rounds.length} 轮 Web Search`)} | ${item.can_estimate ? "是" : "否"} | ${escapeMarkdownCell(item.handling || "报告中标记未知")} |`)
      : ["| 目标结论所需的直接披露、时间范围和统计口径 | 最多两轮 Tavily Search | 否 | 标记未知 |"]),
    "",
    "## 高相关真实搜索来源",
    "",
    sources.length > 0
      ? sources.slice(0, 15).map((source, index) => `${index + 1}. [${source.title || source.url}](${source.url})${source.snippet ? `：${summarizeText(source.snippet, 260)}` : "（仅获得 URL，未读取到正文）"}`).join("\n")
      : "未获得真实搜索来源。",
    "",
    "## 下一步检索建议",
    "",
    arrayify(run.searchDecision?.needed_next_queries).length > 0
      ? arrayify(run.searchDecision.needed_next_queries).map((query) => `- ${query}`).join("\n")
      : "- 获取更高等级来源的原文披露、公告、监管文件、财报材料、采购记录或其他可交叉验证的一手证据。",
    "",
    "## 审计说明",
    "",
    "完整 Prompt、模型返回、工具调用、耗时、Token 用量和错误均记录在 `audit.jsonl` 及对应附件中。",
  ];

  return {
    raw: null,
    text: "",
    error: reason,
    parsed: {
      research_report_md: researchLines.join("\n"),
      verification_report_md: verificationLines.join("\n"),
      final_quality_checks: [
        {
          check: "可核验来源",
          status: evidence.length > 0 ? "warn" : "fail",
          note: finalReason,
        },
        {
          check: "禁止编造",
          status: "pass",
          note: "降级报告未新增输入证据之外的事实或结论。",
        },
      ],
    },
  };
}

function escapeMarkdownCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function normalizeSynthesis(parsed, text, run) {
  if (parsed?.research_report_md && parsed?.verification_report_md) {
    return parsed;
  }
  return {
    research_report_md: `# ${run.plan?.report_title || "行业调研报告"}\n\n${text || "模型未返回可解析报告。请检查核验报告和原始输出。"}`,
    verification_report_md: [
      "# 核验报告",
      "",
      "## 1. 已确认的报告大纲与核验计划",
      "",
      "```json",
      JSON.stringify(run.plan || {}, null, 2),
      "```",
      "",
      "## 2. 搜索任务与结果",
      "",
      "```json",
      JSON.stringify(run.searches.map((item) => ({
        task: item.task,
        rounds: item.rounds.map((round) => ({
          round: round.round,
          parsed: round.parsed,
          sources: round.sources.map(publicSourceSummary),
        })),
      })), null, 2),
      "```",
      "",
      "## 3. 证据抽取",
      "",
      "```json",
      JSON.stringify(run.extraction?.parsed || {}, null, 2),
      "```",
      "",
      "## 4. 说明",
      "",
      "模型未返回可解析 JSON，正式报告为原始输出，建议人工复核后再使用。",
    ].join("\n"),
    final_quality_checks: [{ check: "报告 JSON 解析", status: "warn", note: "模型未按指定 JSON 返回，已保留原始输出。" }],
  };
}

function fallbackPlan(userPrompt) {
  return {
    understanding: `围绕用户需求进行行业调研，并重点核验信源、时间、主体和数据口径。需求：${userPrompt}`,
    report_title: "信源核验型行业调研报告",
    report_outline: [
      {
        section: "核心结论",
        purpose: "回答用户最关心的问题",
        evidence_needed: ["关键事实", "关键数据", "必要推算"],
      },
      {
        section: "分析依据",
        purpose: "说明结论如何由公开信息支撑",
        evidence_needed: ["官方披露", "权威第三方", "交叉验证"],
      },
    ],
    key_items_to_verify: [
      {
        item: "与用户问题直接相关的核心事实和数据",
        type: "data",
        why_needed: "支撑正式报告结论",
        possible_sources: ["官网", "公告", "财报", "统计机构", "权威媒体", "研报", "行业媒体"],
        may_need_estimation: true,
      },
    ],
    search_tasks: [
      {
        task_id: "T1",
        topic: userPrompt || "行业调研主题",
        report_section: "核心结论",
        entities: [],
        time_range: "截至检索日的最新可得信息",
        source_targets: ["官方/一手来源", "权威第三方", "行业媒体", "线索来源"],
        information_needed: ["事实", "数据", "判断", "披露"],
        data_needed: [],
        success_criteria: "找到可追溯来源；如无直接数据，识别可推算变量或明确未知。",
        initial_queries: [userPrompt || "行业调研 信源 核验 数据"],
      },
    ],
    estimation_plan: [],
    confirmation_questions: ["是否确认按该大纲和核验计划开始检索？"],
    quality_checks: ["检索前确认研究对象、地域、时间范围和是否允许推算。"],
  };
}

function buildSearchStatus(task, round, priorDecision) {
  const sources = arrayify(task.source_targets).join("、") || "多类公开来源";
  const queries = arrayify(task.initial_queries).slice(0, 1).join("；");
  const next = arrayify(priorDecision?.needed_next_queries).slice(0, 1).join("；");
  return `主题：${task.topic || task.task_id}；第 ${round}/${config.maxSearchRounds} 轮；优先来源：${sources}；参考查询：${next || queries || "由模型生成"}。`;
}

function streamStep(res, stage, status, title, detail) {
  streamEvent(res, "step", {
    stage,
    status,
    title,
    detail,
    at: new Date().toISOString(),
  });
}

function streamEvent(res, type, payload) {
  res.write(`${JSON.stringify({ type, ...payload })}\n`);
}

function setupStream(res) {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleArtifact(pathname, res) {
  const parts = pathname.split("/").filter(Boolean);
  const runId = parts[2];
  const name = parts[3];
  const isPrimaryArtifact = ["research_report.md", "verification_report.md", "audit.jsonl", "state.json", "ledgers.json", "source_index.json"].includes(name);
  const isAuditAttachment = /^\d{4}-[a-z0-9._-]+-(prompt\.txt|request\.json|response\.json)$/i.test(name || "");
  const isSourceArtifact = /^source-[a-z0-9._-]+\.(json|txt)$/i.test(name || "");
  if (!/^[a-z0-9-]+$/i.test(runId || "") || (!isPrimaryArtifact && !isAuditAttachment && !isSourceArtifact)) {
    return sendJson(res, { error: "Invalid artifact path" }, 400);
  }
  const filePath = join(OUTPUT_DIR, runId, name);
  try {
    await stat(filePath);
  } catch {
    return sendJson(res, { error: "Artifact not found" }, 404);
  }
  res.writeHead(200, {
    "Content-Type": name.endsWith(".jsonl")
      ? "application/x-ndjson; charset=utf-8"
      : name.endsWith(".json")
        ? "application/json; charset=utf-8"
        : name.endsWith(".md")
          ? "text/markdown; charset=utf-8"
          : "text/plain; charset=utf-8",
    "Content-Disposition": `inline; filename="${name}"`,
  });
  createReadStream(filePath).pipe(res);
}

async function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(res, { error: "Forbidden" }, 403);
  }
  try {
    await stat(filePath);
  } catch {
    return sendJson(res, { error: "Not found" }, 404);
  }
  res.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readPrompt(name) {
  return readFile(join(PROMPT_DIR, name), "utf8");
}

function readSecretFile(filePath) {
  try {
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const parsed = parseSecretValue(line);
      if (parsed) return parsed;
    }
    return "";
  } catch {
    return "";
  }
}

function parseSecretValue(line) {
  let value = String(line || "").trim();
  if (!value || value.startsWith("#")) return "";
  const equalsIndex = value.indexOf("=");
  if (equalsIndex >= 0) value = value.slice(equalsIndex + 1).trim();
  value = value.replace(/^["']|["']$/g, "").trim();
  value = value.replace(/^Bearer\s+/i, "").trim();
  const keyMatch = value.match(/sk-[A-Za-z0-9._-]+/);
  return keyMatch?.[0] || value;
}

function loadDotEnv(filePath) {
  try {
    const text = readFileSync(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index < 0) continue;
      const key = trimmed.slice(0, index).trim();
      const value = parseSecretValue(trimmed.slice(index + 1));
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env is optional for static UI preview.
  }
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function makeRunId() {
  return `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

function arrayify(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

function summarizeText(text, maxLength) {
  if (!text) return "";
  const compact = compactWhitespace(text);
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function compactWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function logModelUsage({ provider, stage, model, system, input, outputText, usage, startedAt }) {
  const durationMs = Date.now() - startedAt;
  const inputChars = Buffer.byteLength([system, input].filter(Boolean).join("\n\n"), "utf8");
  const outputChars = Buffer.byteLength(String(outputText || ""), "utf8");
  const promptTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? "";
  const completionTokens = usage?.completion_tokens ?? usage?.output_tokens ?? "";
  const totalTokens = usage?.total_tokens ?? "";
  console.log([
    "model_call",
    `provider=${provider}`,
    `stage=${stage || "unknown"}`,
    `model=${model}`,
    `duration_ms=${durationMs}`,
    `input_bytes=${inputChars}`,
    `output_bytes=${outputChars}`,
    promptTokens !== "" ? `prompt_tokens=${promptTokens}` : "",
    completionTokens !== "" ? `completion_tokens=${completionTokens}` : "",
    totalTokens !== "" ? `total_tokens=${totalTokens}` : "",
  ].filter(Boolean).join(" "));
}

function todayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}
