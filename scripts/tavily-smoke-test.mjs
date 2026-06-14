import { readFileSync } from "node:fs";

function loadEnv(path = ".env") {
  try {
    const env = {};
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index === -1) continue;
      env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
    return env;
  } catch {
    return {};
  }
}

function readSecret(path) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

const env = { ...loadEnv(), ...process.env };
const apiKey = env.TAVILY_API_KEY || readSecret("tavily搜索 api.txt");
const baseUrl = env.TAVILY_BASE_URL || "https://api.tavily.com";
const query = process.argv.slice(2).join(" ") || "阿里云 GPU 采购规模 官方披露";

if (!apiKey) {
  console.error("Missing TAVILY_API_KEY or tavily搜索 api.txt.");
  process.exit(1);
}

const response = await fetch(`${baseUrl.replace(/\/$/, "")}/search`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    query,
    search_depth: env.TAVILY_SEARCH_DEPTH || "basic",
    max_results: 5,
    include_answer: false,
    include_raw_content: "markdown",
    include_usage: true,
  }),
});
const data = await response.json();
if (!response.ok) {
  console.error(`Request failed: ${response.status}`);
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

const results = Array.isArray(data.results) ? data.results : [];
console.log(`query=${data.query || query}`);
console.log(`results=${results.length}`);
console.log(`rawContentResults=${results.filter((item) => item.raw_content).length}`);
console.log(`credits=${data.usage?.credits ?? "unknown"}`);
console.log(`requestId=${data.request_id || ""}`);
