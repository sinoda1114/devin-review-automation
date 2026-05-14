#!/usr/bin/env node
import { execSync } from "node:child_process";
import process from "node:process";
import { readAutomationConfig } from "./automation-config.mjs";

function usage() {
  return `Usage: node scripts/quality-gate.mjs [--help]

Runs quality.commands from .github/devin-automation.yml.
If QUALITY_COMMANDS is set, it overrides the config file commands.

Example:
  quality:
    commands:
      - name: Install
        run: npm ci
      - name: Test
        run: npm test --if-present
`;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

const config = readAutomationConfig();
const qualityConfig = config.quality || {};
const commands = process.env.QUALITY_COMMANDS
  ? parseQualityCommands(process.env.QUALITY_COMMANDS)
  : Array.isArray(qualityConfig.commands) ? qualityConfig.commands : [];
const allowEmpty = process.env.QUALITY_ALLOW_EMPTY
  ? readBool(process.env.QUALITY_ALLOW_EMPTY)
  : qualityConfig.allowEmpty === true;

if (commands.length === 0) {
  const message = "quality.commands が未設定です。PR自動化対象プロジェクトの品質チェックを設定してください。";
  if (allowEmpty) {
    console.warn(message);
    process.exit(0);
  }
  console.error(message);
  process.exit(1);
}

for (const command of commands) {
  if (!command || typeof command.run !== "string" || command.run.trim() === "") {
    console.error("quality.commands には name と run を指定してください。");
    process.exit(1);
  }

  const name = command.name || command.run;
  console.log(`::group::${name}`);
  try {
    execSync(command.run, {
      env: process.env,
      shell: true,
      stdio: "inherit",
    });
  } finally {
    console.log("::endgroup::");
  }
}

console.log("PR Quality Gate passed.");

function readBool(value) {
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseQualityCommands(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((run, index) => ({
      name: `Quality command ${index + 1}`,
      run,
    }));
}
