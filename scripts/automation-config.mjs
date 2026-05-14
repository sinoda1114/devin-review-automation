import { existsSync, readFileSync } from "node:fs";

const DEFAULT_CONFIG_PATH = ".github/devin-automation.yml";

export function readAutomationConfig(path = process.env.DEVIN_AUTOMATION_CONFIG || DEFAULT_CONFIG_PATH) {
  if (!existsSync(path)) {
    return {};
  }

  return parseSimpleYaml(readFileSync(path, "utf8"));
}

function parseSimpleYaml(source) {
  const config = {};
  let section = null;
  let listKey = null;
  let currentItem = null;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripComment(rawLine);
    if (!line.trim()) continue;

    const sectionMatch = line.match(/^([A-Za-z][\w-]*):\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      config[section] = config[section] || {};
      listKey = null;
      currentItem = null;
      continue;
    }

    if (!section) continue;

    const scalarMatch = line.match(/^  ([A-Za-z][\w-]*):\s*(.*)$/);
    if (scalarMatch) {
      const [, key, rawValue] = scalarMatch;
      if (rawValue === "") {
        config[section][key] = [];
        listKey = key;
        currentItem = null;
      } else {
        config[section][key] = parseValue(rawValue);
        listKey = null;
        currentItem = null;
      }
      continue;
    }

    const listItemMatch = line.match(/^    -\s*(.*)$/);
    if (listItemMatch && listKey) {
      const rawValue = listItemMatch[1];
      const keyValueMatch = rawValue.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
      if (keyValueMatch) {
        currentItem = { [keyValueMatch[1]]: parseValue(keyValueMatch[2]) };
        config[section][listKey].push(currentItem);
      } else {
        currentItem = null;
        config[section][listKey].push(parseValue(rawValue));
      }
      continue;
    }

    const nestedPropertyMatch = line.match(/^      ([A-Za-z][\w-]*):\s*(.*)$/);
    if (nestedPropertyMatch && currentItem) {
      currentItem[nestedPropertyMatch[1]] = parseValue(nestedPropertyMatch[2]);
    }
  }

  return config;
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if ((char === "\"" || char === "'") && line[i - 1] !== "\\") {
      quote = quote === char ? null : char;
    }
    if (char === "#" && !quote) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

function parseValue(value) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
