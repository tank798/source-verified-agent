const baseUrl = process.env.AGENT_BASE_URL || "http://127.0.0.1:3000";
const prompt = process.argv.slice(2).join(" ")
  || "只核验阿里云百炼是什么，优先使用一个阿里云官方来源，输出简短报告。";

async function postStream(payload) {
  const response = await fetch(`${baseUrl}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const events = [];
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += Buffer.from(chunk).toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      events.push(event);
      if (event.type === "error") throw new Error(event.message || "Agent stream error");
      if (event.type === "step") {
        console.log(`${event.stage}:${event.status} ${event.title}`);
      }
    }
  }
  return events;
}

const planEvents = await postStream({ action: "plan", prompt });
const planReady = planEvents.find((event) => event.type === "plan_ready");
if (!planReady?.runId) throw new Error("Missing plan_ready/runId");

const executeEvents = await postStream({
  action: "execute",
  runId: planReady.runId,
  userNotes: process.env.AGENT_USER_NOTES || "",
});

const searchRounds = executeEvents.filter((event) => event.type === "search_round");
const realSearchCalls = searchRounds.reduce((sum, event) => sum + (event.toolCalls?.webSearch || 0), 0);
const sources = searchRounds.reduce((sum, event) => sum + (event.sources?.length || 0), 0);
const artifactsEvent = executeEvents.find((event) => event.type === "artifacts");
if (realSearchCalls < 1) throw new Error("No real web_search_call detected");
if (sources < 1) throw new Error("No real search source detected");
if (!artifactsEvent?.artifacts?.length) throw new Error("No artifacts generated");

const auditArtifact = artifactsEvent.artifacts.find((artifact) => artifact.name === "audit.jsonl");
if (!auditArtifact) throw new Error("Missing audit artifact");
const auditText = await fetch(`${baseUrl}${auditArtifact.path}`).then((response) => response.text());
const audit = auditText.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const modelCalls = audit.filter((event) => event.event === "model_call");
const totalTokens = modelCalls.reduce((sum, event) => sum + (event.usage?.total_tokens || 0), 0);
const failedCalls = modelCalls.filter((event) => event.status !== "ok");
const tavilyCalls = audit.filter((event) => event.event === "tool_call" && event.provider === "tavily" && event.tool === "web_search" && event.status === "ok");
const tavilyRawContentResults = tavilyCalls.reduce((sum, event) => sum + (event.rawContentResults || 0), 0);
const stageTokens = Object.fromEntries(modelCalls.map((event) => [event.stage, event.usage?.total_tokens || 0]));
const reportArtifact = artifactsEvent.artifacts.find((artifact) => artifact.name === "research_report.md");
const reportText = reportArtifact
  ? await fetch(`${baseUrl}${reportArtifact.path}`).then((response) => response.text())
  : "";

console.log(`runId=${planReady.runId}`);
console.log(`searchRounds=${searchRounds.length}`);
console.log(`webSearchCalls=${realSearchCalls}`);
console.log(`tavilyCalls=${tavilyCalls.length}`);
console.log(`tavilyRawContentResults=${tavilyRawContentResults}`);
console.log(`sources=${sources}`);
console.log(`modelCalls=${modelCalls.length}`);
console.log(`reportedTokens=${totalTokens}`);
console.log(`stageTokens=${JSON.stringify(stageTokens)}`);
console.log(`artifacts=${artifactsEvent.artifacts.map((artifact) => artifact.name).join(",")}`);

if (tavilyRawContentResults < 1) throw new Error("No Tavily raw_content returned");
const fatalFailedCalls = failedCalls;
if (fatalFailedCalls.length > 0) throw new Error(`Failed model calls: ${fatalFailedCalls.map((event) => event.stage).join(",")}`);
if (!reportText.trim()) throw new Error("Research report is empty");
