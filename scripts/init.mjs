#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";

const STACKS = new Set(["auto", "node", "python", "go", "rust", "other"]);

function usage() {
  return `Usage:
  devin-review-automation init --automation-repository OWNER/REPO [options]

Options:
  --automation-repository, --repo  Central automation repository, for example your-org/devin-review-automation
  --automation-ref                Central automation ref. Default: main
  --stack                         auto, node, python, go, rust, other. Default: auto
  --force                         Overwrite existing generated files
  --dry-run                       Print files without writing
  --help
`;
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "init";

if (args.help || args.h || command === "help") {
  console.log(usage());
  process.exit(0);
}

if (command !== "init") {
  console.error(`Unknown command: ${command}`);
  console.error(usage());
  process.exit(1);
}

const automationRepository =
  args["automation-repository"] || args.repo || process.env.DEVIN_AUTOMATION_REPOSITORY || "";
const automationRef = args["automation-ref"] || process.env.DEVIN_AUTOMATION_REF || "main";
const stack = normalizeStack(args.stack || "auto");
const force = Boolean(args.force);
const dryRun = Boolean(args["dry-run"]);

if (!automationRepository || !/^[^/\s]+\/[^/\s]+$/.test(automationRepository)) {
  console.error("--automation-repository OWNER/REPO を指定してください。");
  console.error("例: devin-review-automation init --automation-repository your-org/devin-review-automation");
  process.exit(1);
}

const detectedStack = stack === "auto" ? detectStack() : stack;
const files = new Map([
  [
    ".github/workflows/devin-automation.yml",
    workflowTemplate({ automationRepository, automationRef }),
  ],
  [
    ".github/devin-automation.yml",
    configTemplate({ stack: detectedStack }),
  ],
]);

for (const [path, content] of files) {
  if (dryRun) {
    console.log(`--- ${path} ---\n${content}`);
    continue;
  }

  if (existsSync(path) && !force) {
    console.error(`${path} already exists. Use --force to overwrite.`);
    process.exit(1);
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`created ${path}`);
}

if (!dryRun) {
  console.log("");
  console.log("Next steps:");
  console.log("1. Review .github/devin-automation.yml.");
  console.log("2. Enable Devin Review / Autofix for this repository.");
  console.log("3. Add Required Checks: PR Quality Gate, Risk Gate.");
  console.log("4. Enable GitHub Auto-merge after the checks are stable.");
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      parsed[rawKey] = inlineValue;
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[rawKey] = true;
    } else {
      parsed[rawKey] = next;
      i += 1;
    }
  }
  return parsed;
}

function normalizeStack(value) {
  if (!STACKS.has(value)) {
    console.error(`Unsupported stack: ${value}`);
    console.error(`Supported stacks: ${Array.from(STACKS).join(", ")}`);
    process.exit(1);
  }
  return value;
}

function detectStack() {
  if (existsSync("package.json")) return "node";
  if (existsSync("pyproject.toml") || existsSync("requirements.txt")) return "python";
  if (existsSync("go.mod")) return "go";
  if (existsSync("Cargo.toml")) return "rust";
  return "other";
}

function workflowTemplate({ automationRepository, automationRef }) {
  return `name: Devin Automation

on:
  pull_request:
    branches:
      - develop
      - main
    types:
      - opened
      - synchronize
      - reopened
      - ready_for_review
  merge_group:

permissions:
  contents: read
  pull-requests: read
  issues: write
  checks: read

concurrency:
  group: devin-automation-\${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  devin-pr-automation:
    uses: ${automationRepository}/.github/workflows/devin-pr-automation.yml@${automationRef}
    with:
      automation-repository: ${automationRepository}
      automation-ref: ${automationRef}
    secrets: inherit
`;
}

function configTemplate({ stack }) {
  const commands = qualityCommandsFor(stack);
  return `# Project-local configuration for Devin Review PR Automation.
# Adjust quality.commands for this repository before enabling auto-merge.

quality:
  allowEmpty: false
  commands:
${commands.map((command) => `    - name: ${command.name}\n      run: ${command.run}`).join("\n")}

risk:
  maxChangedFiles: 10
  maxDiffLines: 300
  maxAutofixCount: 1
  requireDevinReviewSignal: false
  commentOnFailure: true
  devinReviewBotLogins:
    - devin-ai-integration[bot]
    - devin-ai[bot]
    - devin[bot]
  highRiskPatterns:
    - .github/workflows/**
    - package.json
    - package-lock.json
    - pnpm-lock.yaml
    - yarn.lock
    - bun.lockb
    - "**/migrations/**"
    - "**/migration/**"
    - "**/schema/**"
    - "**/auth/**"
    - "**/authorization/**"
    - "**/payment/**"
    - "**/billing/**"
    - "**/terraform/**"
    - "**/*.tf"
    - "**/.env*"
    - "**/secrets/**"
`;
}

function qualityCommandsFor(stack) {
  if (stack === "node") {
    return [
      { name: "Install dependencies", run: "npm ci" },
      { name: "Lint", run: "npm run lint --if-present" },
      { name: "Typecheck", run: "npm run typecheck --if-present" },
      { name: "Test", run: "npm test --if-present" },
      { name: "Build", run: "npm run build --if-present" },
    ];
  }

  if (stack === "python") {
    return [
      { name: "Install dependencies", run: "python -m pip install -r requirements.txt" },
      { name: "Test", run: "pytest" },
    ];
  }

  if (stack === "go") {
    return [
      { name: "Test", run: "go test ./..." },
    ];
  }

  if (stack === "rust") {
    return [
      { name: "Test", run: "cargo test" },
      { name: "Build", run: "cargo build --locked" },
    ];
  }

  return [
    { name: "Define project quality check", run: "echo 'Edit .github/devin-automation.yml quality.commands' && exit 1" },
  ];
}
