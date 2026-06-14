const app = document.querySelector("#app");

const state = {
  view: "landing",
  status: "idle",
  taskDraft: "",
  submittedTask: "",
  runId: null,
  runCreatedAt: null,
  waitingConfirmation: false,
  confirmNotes: "",
  plan: null,
  planRaw: "",
  activities: createInitialActivities(),
  artifacts: [],
  preview: null,
  error: "",
  shareNotice: "",
  abortController: null,
};

await loadConfig();
render();

app.addEventListener("input", (event) => {
  const target = event.target;
  if (target.matches("#taskInput")) {
    state.taskDraft = target.value;
    syncSendButton();
  }
  if (target.matches("#confirmNotes")) {
    state.confirmNotes = target.value;
  }
});

app.addEventListener("submit", async (event) => {
  if (event.target.matches("#landingForm")) {
    event.preventDefault();
    await startTask();
  }
});

app.addEventListener("click", async (event) => {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) return;
  const action = actionTarget.dataset.action;

  if (action === "quick-task") {
    state.taskDraft = actionTarget.dataset.prompt || "";
    render();
    focusTaskInput();
  }

  if (action === "execute-run") {
    await executeRun();
  }

  if (action === "new-task") {
    resetToLanding();
  }

  if (action === "share") {
    await shareRun();
  }

  if (action === "preview-artifact") {
    await openArtifactPreview(actionTarget.dataset.artifactId);
  }

  if (action === "close-preview") {
    state.preview = null;
    render();
  }

  if (action === "retry") {
    state.error = "";
    if (state.waitingConfirmation && state.runId) {
      await executeRun();
    } else if (state.submittedTask) {
      await startTask(state.submittedTask);
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.preview) {
    state.preview = null;
    render();
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && state.view === "landing") {
    startTask();
  }
});

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    if (!config.apiConfigured) {
      state.error = "未检测到完整 API Key，请检查 .env、tavily搜索 api.txt 或 硅基 api.txt。";
    }
  } catch {
    state.error = "配置读取失败，请确认本地服务已启动。";
  }
}

async function startTask(forcedTask) {
  const task = String(forcedTask ?? state.taskDraft).trim();
  if (!task || state.status === "running") return;

  state.view = "task";
  state.status = "running";
  state.submittedTask = task;
  state.taskDraft = task;
  state.runId = null;
  state.runCreatedAt = null;
  state.waitingConfirmation = false;
  state.confirmNotes = "";
  state.plan = null;
  state.planRaw = "";
  state.error = "";
  state.artifacts = [];
  state.preview = null;
  state.activities = createInitialActivities();
  setActivity("plan", "running", {
    description: "正在理解任务边界、报告结构和核验重点。",
  });
  render();

  await streamAgent({
    action: "plan",
    prompt: task,
  });
}

async function executeRun() {
  if (!state.runId || state.status === "running") return;
  state.waitingConfirmation = false;
  state.status = "running";
  setActivity("source-map", "done", {
    description: "报告大纲与核验计划已确认。",
  });
  setActivity("search", "running", {
    description: "正在按信源优先级检索官方、媒体与产业材料。",
  });
  render();

  await streamAgent({
    action: "execute",
    runId: state.runId,
    userNotes: state.confirmNotes,
  });
}

async function streamAgent(payload) {
  if (state.abortController) {
    state.abortController.abort();
  }
  const controller = new AbortController();
  state.abortController = controller;
  try {
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.body) {
      throw new Error("浏览器不支持流式读取。");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        handleStreamEvent(JSON.parse(line));
      }
    }

    if (buffer.trim()) {
      handleStreamEvent(JSON.parse(buffer));
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    applyError(error.message || "执行失败");
  } finally {
    if (state.abortController === controller) {
      state.abortController = null;
    }
  }
}

function handleStreamEvent(event) {
  if (event.type === "run") {
    state.runId = event.runId;
    state.runCreatedAt = event.createdAt;
    render();
    return;
  }

  if (event.type === "step") {
    applyStepEvent(event);
    render();
    return;
  }

  if (event.type === "model_output" && event.stage === "plan") {
    state.planRaw = event.text || "";
    return;
  }

  if (event.type === "plan_ready") {
    state.runId = event.runId;
    state.plan = event.plan;
    state.waitingConfirmation = true;
    state.status = "waiting";
    setActivity("plan", "done", {
      description: "已生成报告大纲、核验重点和搜索任务。",
    });
    setActivity("source-map", "done", {
      description: "已形成信源覆盖计划，等待确认后开始检索。",
    });
    render();
    return;
  }

  if (event.type === "search_round") {
    const toolCalls = event.toolCalls || {};
    const provider = event.provider === "tavily" ? "Tavily Search" : "Web Search";
    const toolSummary = `真实工具调用：${provider} ${toolCalls.webSearch || 0} 次。`;
    removeToolCall("search", "web_search_active");
    setActivity("search", "done", {
      description: `完成 ${event.taskId || "搜索任务"} 第 ${event.round || 1} 轮检索，获得 ${(event.sources || []).length} 个候选来源。`,
    });
    upsertToolCall("search", {
      id: `web_search_${event.taskId || "task"}_${event.round || 1}`,
      name: event.provider === "tavily" ? "tavily_search" : "web_search",
      status: (toolCalls.total || 0) > 0 ? "done" : "error",
      inputSummary: "按官方/权威第三方/产业线索顺序检索公开资料",
      outputSummary: `${toolSummary}${event.summary ? ` ${event.summary}` : ""}`,
      durationMs: null,
      meta: (event.sources || []).slice(0, 8).map((source) => source.url).filter(Boolean),
    });
    render();
    return;
  }

  if (event.type === "extraction") {
    setActivity("extract", "done", {
      description: `已抽取 ${event.evidenceCount || 0} 条证据，并完成信源评分。`,
    });
    setActivity("verify", "done", {
      description: "已完成交叉验证、冲突记录和缺失数据处理。",
    });
    upsertToolCall("extract", {
      id: "source_ranker",
      name: "source_ranker",
      status: "done",
      inputSummary: "对来源进行 S/A/B/C/D 分级与可信度评分",
      outputSummary: formatCoverage(event.sourceCoverage),
      durationMs: null,
      meta: (event.qualityChecks || []).map((item) => `${item.status}: ${item.check} - ${item.note}`),
    });
    upsertToolCall("verify", {
      id: "cross_validator",
      name: "cross_validator",
      status: "done",
      inputSummary: "合并相似 claim，检查独立信源、冲突和缺口",
      outputSummary: `${(event.clusters || []).length} 个 claim cluster，${(event.missingData || []).length} 项缺失记录。`,
      durationMs: null,
      meta: (event.clusters || []).slice(0, 6).map((item) => `${item.status}: ${item.claim}`),
    });
    render();
    return;
  }

  if (event.type === "artifacts") {
    state.status = "completed";
    state.artifacts = normalizeArtifacts(event.artifacts || []);
    finalizeCompletedActivities();
    setActivity("report", "done", {
      description: "正式报告和核验报告已生成，可预览或下载。",
    });
    upsertToolCall("report", {
      id: "report_writer",
      name: "report_writer",
      status: "done",
      inputSummary: "基于证据表、逻辑链和确认后的大纲生成两份文件",
      outputSummary: `${state.artifacts.length} 个文件已生成。`,
      durationMs: null,
      meta: state.artifacts.map((artifact) => `${artifact.name} · ${artifact.size || ""}`),
    });
    render();
    return;
  }

  if (event.type === "error") {
    applyError(event.message || "执行错误");
  }
}

function applyStepEvent(event) {
  const status = event.status === "completed" ? "done" : event.status === "running" ? "running" : event.status || "pending";

  if (event.stage === "plan") {
    setActivity("plan", status, {
      description: event.detail || "正在拆解调研问题。",
    });
  }

  if (event.stage === "execute") {
    setActivity("source-map", status === "running" ? "running" : status, {
      description: event.detail || "正在整理任务计划。",
    });
  }

  if (event.stage === "search") {
    setActivity("search", status, {
      description: event.detail || "正在检索信源。",
    });
    if (status === "running") {
      upsertToolCall("search", {
        id: "web_search_active",
        name: "tavily_search",
        status: "running",
        inputSummary: event.detail || "正在生成查询并调用搜索。",
        outputSummary: "等待搜索结果返回。",
      });
    } else {
      removeToolCall("search", "web_search_active");
    }
  }

  if (event.stage === "extract") {
    setActivity("extract", status, {
      description: event.detail || "正在抽取证据。",
    });
    if (status === "running") {
      upsertToolCall("extract", {
        id: "source_ranker",
        name: "source_ranker",
        status: "running",
        inputSummary: "抽取证据、识别信源等级、检查时间口径。",
        outputSummary: "等待评分结果。",
      });
    }
  }

  if (event.stage === "synthesize") {
    setActivity("report", status, {
      description: event.detail || "正在生成最终文件。",
    });
    if (status === "running") {
      upsertToolCall("report", {
        id: "report_writer",
        name: "report_writer",
        status: "running",
        inputSummary: "把证据链转为正式报告和核验报告。",
        outputSummary: "等待文件生成。",
      });
    }
  }
}

function applyError(message) {
  state.status = "error";
  state.error = message;
  for (const running of state.activities.filter((item) => item.status === "running")) {
    setActivity(running.id, "error", { description: message });
    running.toolCalls = running.toolCalls.map((tool) => (
      tool.status === "running"
        ? { ...tool, status: "error", outputSummary: message }
        : tool
    ));
  }
  render();
}

function finalizeCompletedActivities() {
  for (const step of state.activities) {
    if (step.status === "running") {
      step.status = "done";
      step.description = step.description || "流程已结束，详见运行日志和核验报告。";
    }
    step.toolCalls = step.toolCalls.map((tool) => (
      tool.status === "running"
        ? { ...tool, status: "done", outputSummary: tool.outputSummary || "流程已结束。" }
        : tool
    ));
  }
  removeToolCall("search", "web_search_active");
}

function resetToLanding() {
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
  state.view = "landing";
  state.status = "idle";
  state.taskDraft = "";
  state.submittedTask = "";
  state.runId = null;
  state.runCreatedAt = null;
  state.waitingConfirmation = false;
  state.confirmNotes = "";
  state.plan = null;
  state.planRaw = "";
  state.activities = createInitialActivities();
  state.artifacts = [];
  state.preview = null;
  state.error = "";
  state.shareNotice = "";
  render();
}

async function shareRun() {
  const text = state.runId
    ? `信源整合型调研 Agent 任务：${state.submittedTask}\nRun ID: ${state.runId}`
    : "信源整合型调研 Agent";
  try {
    await navigator.clipboard.writeText(text);
    state.shareNotice = "已复制";
  } catch {
    state.shareNotice = "复制失败";
  }
  render();
  setTimeout(() => {
    state.shareNotice = "";
    render();
  }, 1400);
}

async function openArtifactPreview(artifactId) {
  const artifact = state.artifacts.find((item) => item.id === artifactId);
  if (!artifact) return;
  state.preview = {
    artifact,
    status: "loading",
    content: "",
    rendered: "",
  };
  render();

  try {
    const response = await fetch(artifact.url);
    const content = await response.text();
    state.preview = {
      artifact,
      status: "ready",
      content,
      rendered: artifact.type === "markdown" ? renderMarkdown(content) : renderPlainPreview(content),
    };
  } catch (error) {
    state.preview = {
      artifact,
      status: "error",
      content: "",
      rendered: `<p>${escapeHtml(error.message || "预览失败")}</p>`,
    };
  }
  render();
}

function render() {
  app.innerHTML = state.view === "landing" ? renderLanding() : renderTaskWorkspace();
  syncSendButton();
  if (state.view === "landing") focusTaskInput(false);
}

function renderLanding() {
  return `
    <main class="landing-shell">
      <section class="landing-hero" aria-labelledby="landingTitle">
        <div class="quiet-mark" aria-hidden="true">
          ${icon("radar")}
        </div>
        <h1 id="landingTitle">我能为你做什么？</h1>
        <p class="hero-subtitle">把分散信源、数据口径和推算链路整理成可追溯的调研结果。</p>

        <form id="landingForm" class="task-composer">
          <textarea
            id="taskInput"
            rows="6"
            placeholder="分配一个任务或提问任何问题"
            aria-label="任务输入"
          >${escapeHtml(state.taskDraft)}</textarea>
          <button class="send-button" type="submit" aria-label="发送任务" ${state.taskDraft.trim() ? "" : "disabled"}>
            ${icon("arrowUp")}
          </button>
        </form>

        <div class="quick-tasks" aria-label="快捷任务">
          ${quickTaskButton("行业调研", "请围绕一个行业做专业咨询式调研，区分事实、数据和判断，并输出正式报告和核验报告。")}
          ${quickTaskButton("信源核验", "请核验以下材料或说法的来源质量、时间口径、主体口径和交叉验证状态。")}
          ${quickTaskButton("生成报告", "请基于公开信源完成一份简短咨询报告，并把证据链单独放入核验报告。")}
          ${quickTaskButton("整理证据表", "请围绕给定研究问题检索公开资料，整理证据表、信源等级、时间口径和正文映射。")}
        </div>

        ${state.error ? `<div class="inline-error">${escapeHtml(state.error)}</div>` : ""}
      </section>
    </main>
  `;
}

function renderTaskWorkspace() {
  return `
    <main class="task-shell">
      <header class="task-topbar">
        <div class="task-topbar-left">
          <span class="run-state ${state.status}">${statusText()}</span>
        </div>
        <div class="task-actions">
          <button class="ghost-button" type="button" data-action="new-task">${icon("plus")}<span>新建任务</span></button>
          <button class="ghost-button" type="button" data-action="share">${icon("share")}<span>${state.shareNotice || "分享"}</span></button>
        </div>
      </header>

      <section class="task-stage">
        ${renderTaskHeaderCard()}
        ${renderPlanConfirmation()}
        ${renderActivityStream()}
        ${renderArtifactSection()}
        ${state.error ? renderErrorBlock() : ""}
      </section>

      ${state.preview ? renderPreviewModal() : ""}
    </main>
  `;
}

function renderTaskHeaderCard() {
  return `
    <section class="task-card">
      <div class="task-card-head">
        <div>
          <span class="eyebrow">Task</span>
          <h1>${escapeHtml(state.plan?.report_title || "信源整合型调研任务")}</h1>
        </div>
        ${state.runId ? `<code>${escapeHtml(state.runId)}</code>` : ""}
      </div>
      <details class="task-detail" ${state.submittedTask.length < 180 ? "open" : ""}>
        <summary>${state.submittedTask.length > 180 ? "查看完整任务" : "任务内容"}</summary>
        <p>${escapeHtml(state.submittedTask)}</p>
      </details>
    </section>
  `;
}

function renderPlanConfirmation() {
  if (!state.waitingConfirmation || !state.plan) return "";
  const outline = (state.plan.report_outline || []).slice(0, 5).map((item) => `
    <li>
      <strong>${escapeHtml(item.section || "未命名部分")}</strong>
      <span>${escapeHtml(item.purpose || "")}</span>
    </li>
  `).join("");
  const tasks = (state.plan.search_tasks || []).slice(0, 5).map((task) => `
    <li>
      <strong>${escapeHtml(task.task_id || "")}</strong>
      <span>${escapeHtml(task.topic || "")}</span>
    </li>
  `).join("");

  return `
    <section class="confirm-card">
      <div class="confirm-grid">
        <div>
          <span class="eyebrow">Plan ready</span>
          <h2>确认大纲与核验计划</h2>
          <p>${escapeHtml(state.plan.understanding || "已生成报告大纲、核验重点和搜索任务。")}</p>
        </div>
        <div class="plan-columns">
          <div>
            <h3>正式报告大纲</h3>
            <ol>${outline}</ol>
          </div>
          <div>
            <h3>搜索任务</h3>
            <ol>${tasks}</ol>
          </div>
        </div>
      </div>
      <textarea id="confirmNotes" rows="3" placeholder="可选：补充时间范围、目标主体、报告格式或是否允许推算">${escapeHtml(state.confirmNotes)}</textarea>
      <div class="confirm-actions">
        <button class="primary-button" type="button" data-action="execute-run">${icon("play")}<span>确认并开始检索</span></button>
      </div>
    </section>
  `;
}

function renderActivityStream() {
  return `
    <section class="activity-panel" aria-label="Agent 执行流">
      <div class="section-heading">
        <span class="eyebrow">Activity</span>
        <h2>Agent 正在做什么</h2>
      </div>
      <div class="activity-list">
        ${state.activities.map(renderActivityItem).join("")}
      </div>
    </section>
  `;
}

function renderActivityItem(step) {
  return `
    <article class="activity-item ${step.status}">
      <div class="activity-rail">
        <span class="status-node">${statusIcon(step.status)}</span>
      </div>
      <div class="activity-body">
        <div class="activity-title-row">
          <h3>${escapeHtml(step.title)}</h3>
          <span class="activity-status">${activityStatusText(step.status)}</span>
        </div>
        <p>${escapeHtml(step.description || "")}</p>
        ${step.toolCalls.length ? `<div class="tool-list">${step.toolCalls.map(renderToolCall).join("")}</div>` : ""}
      </div>
    </article>
  `;
}

function renderToolCall(tool) {
  const metaItems = Array.isArray(tool.meta) && tool.meta.length
    ? `<ul>${tool.meta.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "";

  return `
    <details class="tool-call">
      <summary>
        <span>${icon("tool")}${escapeHtml(tool.name)}</span>
        <em class="${tool.status}">${toolStatusText(tool.status)}</em>
      </summary>
      <div class="tool-call-body">
        ${tool.inputSummary ? `<p><strong>任务</strong>${escapeHtml(tool.inputSummary)}</p>` : ""}
        ${tool.outputSummary ? `<p><strong>返回</strong>${escapeHtml(tool.outputSummary)}</p>` : ""}
        ${tool.durationMs ? `<p><strong>耗时</strong>${Math.round(tool.durationMs)} ms</p>` : ""}
        ${metaItems}
      </div>
    </details>
  `;
}

function renderArtifactSection() {
  if (!state.artifacts.length) return "";
  return `
    <section class="artifact-section">
      <div class="section-heading">
        <span class="eyebrow">Files</span>
        <h2>生成结果</h2>
      </div>
      <div class="artifact-grid">
        ${state.artifacts.map(renderArtifactCard).join("")}
      </div>
    </section>
  `;
}

function renderArtifactCard(artifact) {
  return `
    <article class="artifact-card" data-action="preview-artifact" data-artifact-id="${escapeAttr(artifact.id)}">
      <div class="file-icon">${icon("file")}</div>
      <div class="file-meta">
        <h3>${escapeHtml(artifact.name)}</h3>
        <p>${escapeHtml(artifact.typeLabel)}${artifact.size ? ` · ${escapeHtml(artifact.size)}` : ""}${artifact.createdAt ? ` · ${escapeHtml(artifact.createdAt)}` : ""}</p>
      </div>
      <div class="file-actions">
        <button type="button" class="ghost-button compact" data-action="preview-artifact" data-artifact-id="${escapeAttr(artifact.id)}">预览</button>
        <a class="ghost-button compact" href="${escapeAttr(artifact.url)}" download="${escapeAttr(artifact.downloadName)}" onclick="event.stopPropagation()">下载</a>
      </div>
    </article>
  `;
}

function renderPreviewModal() {
  const preview = state.preview;
  const artifact = preview.artifact;
  return `
    <div class="modal-backdrop" data-action="close-preview">
      <section class="preview-modal" role="dialog" aria-modal="true" aria-label="文件预览" onclick="event.stopPropagation()">
        <header class="preview-head">
          <div>
            <span class="eyebrow">Preview</span>
            <h2>${escapeHtml(artifact.name)}</h2>
            <p>${escapeHtml(artifact.typeLabel)}${artifact.size ? ` · ${escapeHtml(artifact.size)}` : ""}</p>
          </div>
          <button class="icon-button" type="button" data-action="close-preview" aria-label="关闭预览">${icon("x")}</button>
        </header>
        <div class="preview-body ${artifact.type}">
          ${preview.status === "loading" ? `<div class="preview-loading">正在加载预览...</div>` : preview.rendered}
        </div>
        <footer class="preview-foot">
          <a class="primary-button" href="${escapeAttr(artifact.url)}" download="${escapeAttr(artifact.downloadName)}">${icon("download")}<span>下载文件</span></a>
        </footer>
      </section>
    </div>
  `;
}

function renderErrorBlock() {
  return `
    <section class="error-card">
      <div>
        <h2>任务执行失败</h2>
        <p>${escapeHtml(state.error)}</p>
      </div>
      <button class="ghost-button" type="button" data-action="retry">${icon("refresh")}<span>重试</span></button>
    </section>
  `;
}

function quickTaskButton(label, prompt) {
  return `<button type="button" data-action="quick-task" data-prompt="${escapeAttr(prompt)}">${escapeHtml(label)}</button>`;
}

function createInitialActivities() {
  return [
    {
      id: "plan",
      title: "正在拆解调研问题...",
      description: "识别报告目标、主体、时间范围和核验重点。",
      status: "pending",
      toolCalls: [],
    },
    {
      id: "source-map",
      title: "正在生成信源地图...",
      description: "规划官方、权威媒体、产业材料和低可信线索的覆盖路径。",
      status: "pending",
      toolCalls: [],
    },
    {
      id: "search",
      title: "正在检索官方、媒体与产业信源...",
      description: "按信源等级检索并保留候选来源链接。",
      status: "pending",
      toolCalls: [],
    },
    {
      id: "extract",
      title: "正在抽取证据表...",
      description: "抽取事实、数据、原文、中文翻译、时间和口径字段。",
      status: "pending",
      toolCalls: [],
    },
    {
      id: "verify",
      title: "正在进行交叉验证...",
      description: "合并相近说法，检查独立性、冲突、缺口和置信度。",
      status: "pending",
      toolCalls: [],
    },
    {
      id: "report",
      title: "正在生成最终报告...",
      description: "输出正式报告和核验报告两个文件。",
      status: "pending",
      toolCalls: [],
    },
  ];
}

function setActivity(id, status, patch = {}) {
  const step = state.activities.find((item) => item.id === id);
  if (!step) return;
  step.status = status;
  Object.assign(step, patch);
}

function upsertToolCall(stepId, tool) {
  const step = state.activities.find((item) => item.id === stepId);
  if (!step) return;
  const index = step.toolCalls.findIndex((item) => item.id === tool.id);
  const next = {
    id: tool.id,
    name: tool.name,
    status: tool.status || "running",
    inputSummary: tool.inputSummary || "",
    outputSummary: tool.outputSummary || "",
    durationMs: tool.durationMs ?? null,
    meta: tool.meta || [],
  };
  if (index >= 0) {
    step.toolCalls[index] = { ...step.toolCalls[index], ...next };
  } else {
    step.toolCalls.push(next);
  }
}

function removeToolCall(stepId, toolId) {
  const step = state.activities.find((item) => item.id === stepId);
  if (!step) return;
  step.toolCalls = step.toolCalls.filter((item) => item.id !== toolId);
}

function normalizeArtifacts(artifacts) {
  return artifacts.map((artifact, index) => {
    const isVerification = artifact.name.includes("verification");
    const isAudit = artifact.name.includes("audit");
    const isState = artifact.name === "state.json";
    const isLedgers = artifact.name === "ledgers.json";
    const type = artifact.name.endsWith(".md") ? "markdown" : artifact.name.endsWith(".jsonl") ? "jsonl" : artifact.name.endsWith(".json") ? "json" : artifact.name.endsWith(".csv") ? "csv" : "file";
    return {
      id: artifact.name || `artifact-${index}`,
      name: isAudit ? "运行日志.jsonl" : isState ? "运行状态.json" : isLedgers ? "证据账本.json" : isVerification ? "信源核验报告.md" : "分析报告.md",
      downloadName: artifact.name || `artifact-${index}`,
      type,
      typeLabel: type === "markdown" ? "Markdown" : type === "jsonl" ? "JSONL" : type === "json" ? "JSON" : type.toUpperCase(),
      url: artifact.path || artifact.url,
      size: artifact.bytes ? formatBytes(artifact.bytes) : artifact.size || "",
      createdAt: formatShortTime(new Date()),
    };
  });
}

function formatCoverage(coverage = {}) {
  const parts = ["S", "A", "B", "C", "D"].map((level) => `${level} ${coverage[level] || 0}`);
  return `${parts.join(" / ")}。${coverage.coverage_comment || ""}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatShortTime(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function statusText() {
  if (state.status === "running") return "运行中";
  if (state.status === "waiting") return "待确认";
  if (state.status === "completed") return "已完成";
  if (state.status === "error") return "失败";
  return "待输入";
}

function activityStatusText(status) {
  return {
    pending: "待执行",
    running: "执行中",
    done: "已完成",
    error: "失败",
  }[status] || status;
}

function toolStatusText(status) {
  return {
    running: "调用中",
    done: "完成",
    error: "失败",
  }[status] || status;
}

function statusIcon(status) {
  if (status === "running") return `<span class="pulse-dot"></span>`;
  if (status === "done") return icon("check");
  if (status === "error") return icon("alert");
  return "";
}

function syncSendButton() {
  const button = document.querySelector(".send-button");
  if (button) button.disabled = !state.taskDraft.trim() || state.status === "running";
}

function focusTaskInput(shouldFocus = true) {
  if (!shouldFocus) return;
  const input = document.querySelector("#taskInput");
  if (input) input.focus();
}

function renderMarkdown(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    if (/^#{1,4}\s/.test(line)) {
      const level = Math.min(line.match(/^#+/)[0].length, 4);
      html.push(`<h${level}>${renderInline(line.replace(/^#{1,4}\s/, ""))}</h${level}>`);
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const tableLines = [];
      while (index < lines.length && /^\s*\|/.test(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      html.push(renderTable(tableLines));
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      html.push(`<ul>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      html.push(`<ol>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return `<article class="markdown-preview">${html.join("")}</article>`;
}

function renderPlainPreview(content) {
  return `<pre><code>${escapeHtml(content)}</code></pre>`;
}

function isBlockStart(lines, index) {
  const line = lines[index] || "";
  return line.startsWith("```") || /^#{1,4}\s/.test(line) || isTableStart(lines, index) || /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line);
}

function isTableStart(lines, index) {
  return /^\s*\|/.test(lines[index] || "") && /^\s*\|?\s*:?-{3,}:?\s*\|/.test(lines[index + 1] || "");
}

function renderTable(tableLines) {
  const rows = tableLines
    .filter((line, index) => index !== 1)
    .map((line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()));
  const [head = [], ...body] = rows;
  return `
    <div class="table-scroll">
      <table>
        <thead><tr>${head.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead>
        <tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderInline(text) {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function icon(name) {
  const icons = {
    arrowUp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="m5 12 7-7 7 7"></path></svg>',
    chevronDown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>',
    radar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 1 0-9-9"></path><path d="M12 17a5 5 0 1 0-5-5"></path><path d="M12 13a1 1 0 1 0-1-1"></path><path d="M12 12 4 20"></path></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"></path><path d="M12 15V3"></path><path d="m7 8 5-5 5 5"></path></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 13 4 4L19 7"></path></svg>',
    alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5"></path><path d="M12 17h.01"></path><path d="M10.3 4.3 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"></path></svg>',
    tool: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5 5L4 17v3h3l5.7-5.7a4 4 0 0 0 5-5l-3 3-3-3Z"></path></svg>',
    file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"></path><path d="M14 3v5h5"></path><path d="M8 13h8"></path><path d="M8 17h5"></path></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7Z"></path></svg>',
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7"></path><path d="M20 4v6h-6"></path></svg>',
  };
  return icons[name] || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
