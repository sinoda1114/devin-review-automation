#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import process from "node:process";
import { readAutomationConfig } from "./automation-config.mjs";

const DEFAULT_HIGH_RISK_PATTERNS = [
  ".github/workflows/**",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "**/migrations/**",
  "**/migration/**",
  "**/schema/**",
  "**/auth/**",
  "**/authorization/**",
  "**/payment/**",
  "**/billing/**",
  "**/terraform/**",
  "**/*.tf",
  "**/.env*",
  "**/secrets/**",
];

const TEST_PATTERNS = [
  "**/__tests__/**",
  "**/test/**",
  "**/tests/**",
  "**/*.test.*",
  "**/*.spec.*",
];

function usage() {
  return `Usage: node scripts/risk-gate.mjs [--help]

Environment:
  DEVIN_AUTOMATION_CONFIG       default: .github/devin-automation.yml
  MAX_CHANGED_FILES             default: 10
  MAX_DIFF_LINES                default: 300
  MAX_AUTOFIX_COUNT             default: 1
  HIGH_RISK_PATTERNS            newline separated glob list
  REQUIRE_DEVIN_REVIEW_SIGNAL   true/false, default: false
  DEVIN_REVIEW_BOT_LOGINS       comma separated, default: devin-ai-integration[bot],devin-ai[bot],devin[bot]
  COMMENT_ON_FAILURE            true/false, default: true
`;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

const env = process.env;
const config = readAutomationConfig();
const riskConfig = config.risk || {};
const maxChangedFiles = readPositiveInt("MAX_CHANGED_FILES", riskConfig.maxChangedFiles ?? 10);
const maxDiffLines = readPositiveInt("MAX_DIFF_LINES", riskConfig.maxDiffLines ?? 300);
const maxAutofixCount = readPositiveInt("MAX_AUTOFIX_COUNT", riskConfig.maxAutofixCount ?? 1);
const requireDevinSignal = readBool("REQUIRE_DEVIN_REVIEW_SIGNAL", riskConfig.requireDevinReviewSignal ?? false);
const commentOnFailure = readBool("COMMENT_ON_FAILURE", riskConfig.commentOnFailure ?? true);
const highRiskPatterns = readList("HIGH_RISK_PATTERNS", riskConfig.highRiskPatterns ?? DEFAULT_HIGH_RISK_PATTERNS);
const devinBotLogins = readList("DEVIN_REVIEW_BOT_LOGINS", riskConfig.devinReviewBotLogins ?? [
  "devin-ai-integration[bot]",
  "devin-ai[bot]",
  "devin[bot]",
]).map((value) => value.toLowerCase());

const result = {
  status: "pass",
  reasons: [],
  warnings: [],
  metrics: {
    changedFiles: 0,
    diffLines: 0,
    autofixCount: 0,
    highRiskFiles: [],
    deletedTests: [],
    devinSignalFound: false,
    devinBlockerFound: false,
  },
};

try {
  const event = readEvent();
  const range = resolveDiffRange(event);
  const changedFiles = getChangedFiles(range);
  const nameStatus = getNameStatus(range);
  const diffLines = getDiffLines(range);
  const autofixCount = getAutofixCount(range);

  result.metrics.changedFiles = changedFiles.length;
  result.metrics.diffLines = diffLines;
  result.metrics.autofixCount = autofixCount;
  result.metrics.highRiskFiles = changedFiles.filter((file) =>
    highRiskPatterns.some((pattern) => matchesGlob(file, pattern)),
  );
  result.metrics.deletedTests = nameStatus
    .filter(({ status, file }) => status.startsWith("D") && TEST_PATTERNS.some((pattern) => matchesGlob(file, pattern)))
    .map(({ file }) => file);

  if (changedFiles.length > maxChangedFiles) {
    fail(`変更ファイル数が閾値を超過しています: ${changedFiles.length}/${maxChangedFiles}`);
  }

  if (diffLines > maxDiffLines) {
    fail(`差分行数が閾値を超過しています: ${diffLines}/${maxDiffLines}`);
  }

  if (result.metrics.highRiskFiles.length > 0) {
    fail(`高リスクファイルが変更されています: ${result.metrics.highRiskFiles.join(", ")}`);
  }

  if (result.metrics.deletedTests.length > 0) {
    fail(`テストファイルが削除されています: ${result.metrics.deletedTests.join(", ")}`);
  }

  if (autofixCount > maxAutofixCount) {
    fail(`Autofix回数が上限を超過しています: ${autofixCount}/${maxAutofixCount}`);
  }

  const prNumber = getPullRequestNumber(event);
  if (prNumber && env.GITHUB_TOKEN && env.GITHUB_REPOSITORY) {
    try {
      const devinReview = await inspectDevinReview(prNumber);
      result.metrics.devinSignalFound = devinReview.signalFound;
      result.metrics.devinBlockerFound = devinReview.blockerFound;

      if (devinReview.blockerFound) {
        fail("Devin Reviewでblocker相当の指摘が検出されています");
      }
    } catch (error) {
      if (requireDevinSignal) {
        fail(`Devin Review結果を取得できないため判断不能です: ${error.message}`);
      } else {
        result.warnings.push(`Devin Review結果は確認できませんでした: ${error.message}`);
      }
    }
  } else if (requireDevinSignal) {
    fail("Devin Review結果を取得できないため判断不能です");
  } else {
    result.warnings.push("Devin Review結果はこの実行では確認していません");
  }

  if (requireDevinSignal && !result.metrics.devinSignalFound) {
    fail("Devin Reviewの実行痕跡が見つからないため判断不能です");
  }
} catch (error) {
  fail(`Risk Gate実行中に判断不能なエラーが発生しました: ${error.message}`);
}

if (result.reasons.length > 0) {
  result.status = "fail";
}

writeSummary(result);

if (result.status === "fail") {
  await maybeCommentOnPullRequest(result);
  process.exit(1);
}

console.log("Risk Gate passed.");

function readPositiveInt(name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function readBool(name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function readList(name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return Array.isArray(fallback) ? fallback : [fallback].filter(Boolean);
  return raw
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function readEvent() {
  if (!env.GITHUB_EVENT_PATH || !existsSync(env.GITHUB_EVENT_PATH)) {
    return {};
  }
  return JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
}

function resolveDiffRange(event) {
  const base = env.PR_BASE_SHA || event.pull_request?.base?.sha || event.merge_group?.base_sha;
  const head = env.PR_HEAD_SHA || event.pull_request?.head?.sha || event.merge_group?.head_sha || "HEAD";

  if (!base) {
    throw new Error("base SHAを特定できません");
  }

  ensureCommit(base);
  ensureCommit(head);

  return { base, head };
}

function ensureCommit(ref) {
  try {
    git(["cat-file", "-e", `${ref}^{commit}`]);
  } catch {
    git(["fetch", "--no-tags", "--prune", "--depth=1", "origin", ref]);
  }
}

function getChangedFiles(range) {
  return git(["diff", "--name-only", `${range.base}...${range.head}`])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getNameStatus(range) {
  return git(["diff", "--name-status", `${range.base}...${range.head}`])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, ...paths] = line.split(/\t+/);
      return { status, file: paths.at(-1) };
    })
    .filter(({ file }) => Boolean(file));
}

function getDiffLines(range) {
  return git(["diff", "--numstat", `${range.base}...${range.head}`])
    .split(/\r?\n/)
    .filter(Boolean)
    .reduce((total, line) => {
      const [added, deleted] = line.split(/\s+/);
      return total + toCount(added) + toCount(deleted);
    }, 0);
}

function getAutofixCount(range) {
  const log = git(["log", "--format=%s%n%b%x1e", `${range.base}...${range.head}`]);
  return log
    .split("\x1e")
    .filter((entry) => /devin/i.test(entry) && /autofix|auto-fix|fix commit|修正/i.test(entry))
    .length;
}

function toCount(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function matchesGlob(file, pattern) {
  const normalizedFile = file.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");
  return globToRegExp(normalizedPattern).test(normalizedFile);
}

function globToRegExp(pattern) {
  let source = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    const next = pattern[i + 1];

    if (char === "*" && next === "*") {
      const after = pattern[i + 2];
      if (after === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExp(char);
  }
  return new RegExp(`${source}$`);
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

function fail(reason) {
  result.reasons.push(reason);
}

function getPullRequestNumber(event) {
  return event.pull_request?.number || env.PR_NUMBER || undefined;
}

async function inspectDevinReview(prNumber) {
  const comments = await githubApi(`/repos/${env.GITHUB_REPOSITORY}/issues/${prNumber}/comments`);
  const reviews = await githubApi(`/repos/${env.GITHUB_REPOSITORY}/pulls/${prNumber}/reviews`);
  const entries = [...comments, ...reviews].filter((entry) => {
    const login = entry.user?.login?.toLowerCase();
    return login && devinBotLogins.includes(login);
  });

  const bodyText = entries.map((entry) => entry.body || "").join("\n");
  return {
    signalFound: entries.length > 0,
    blockerFound: /\b(blocker|critical|must fix|security|重大|致命|要修正)\b/i.test(bodyText),
  };
}

async function githubApi(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${path} failed: ${response.status}`);
  }

  return response.json();
}

function writeSummary(currentResult) {
  const lines = [
    `# Risk Gate: ${currentResult.status.toUpperCase()}`,
    "",
    "## Metrics",
    "",
    `- Changed files: ${currentResult.metrics.changedFiles}/${maxChangedFiles}`,
    `- Diff lines: ${currentResult.metrics.diffLines}/${maxDiffLines}`,
    `- Autofix count: ${currentResult.metrics.autofixCount}/${maxAutofixCount}`,
    `- Devin signal found: ${currentResult.metrics.devinSignalFound}`,
    `- Devin blocker found: ${currentResult.metrics.devinBlockerFound}`,
    "",
  ];

  if (currentResult.metrics.highRiskFiles.length > 0) {
    lines.push("## High Risk Files", "", ...currentResult.metrics.highRiskFiles.map((file) => `- ${file}`), "");
  }

  if (currentResult.metrics.deletedTests.length > 0) {
    lines.push("## Deleted Tests", "", ...currentResult.metrics.deletedTests.map((file) => `- ${file}`), "");
  }

  if (currentResult.reasons.length > 0) {
    lines.push("## Stop Reasons", "", ...currentResult.reasons.map((reason) => `- ${reason}`), "");
  }

  if (currentResult.warnings.length > 0) {
    lines.push("## Warnings", "", ...currentResult.warnings.map((warning) => `- ${warning}`), "");
  }

  const summary = `${lines.join("\n")}\n`;
  console.log(summary);

  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  }
}

async function maybeCommentOnPullRequest(currentResult) {
  if (!commentOnFailure || !env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY || !env.GITHUB_EVENT_PATH) {
    return;
  }

  const prNumber = getPullRequestNumber(readEvent());
  if (!prNumber) {
    return;
  }

  const body = [
    "## Risk Gate failed",
    "",
    "自動マージを停止し、Human in the loop に切り替えてください。",
    "",
    "### 理由",
    ...currentResult.reasons.map((reason) => `- ${reason}`),
  ].join("\n");

  try {
    await githubApi(`/repos/${env.GITHUB_REPOSITORY}/issues/${prNumber}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  } catch (error) {
    console.warn(`Risk Gate failure comment could not be posted: ${error.message}`);
  }
}
