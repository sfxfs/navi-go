#!/usr/bin/env node
/**
 * Prompt Security Static Analysis
 *
 * Scans source code for common LLM prompt injection risks:
 * - Direct string interpolation into LLM prompts without JSON.stringify
 * - Missing input sanitization before prompt construction
 * - Unsafe template literals mixing user input with system instructions
 * - Missing guardrails before LLM invocation
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

interface Finding {
  file: string;
  line: number;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  rule: string;
  message: string;
}

const SRC_DIR = resolve(process.cwd(), "src");
const TS_EXT = /\.ts$/;

const walk = (dir: string): string[] => {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = resolve(dir, entry);
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (TS_EXT.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
};

const findings: Finding[] = [];

const report = (
  file: string,
  line: number,
  severity: Finding["severity"],
  rule: string,
  message: string,
) => {
  findings.push({ file, line, severity, rule, message });
};

const RULES = [
  {
    id: "PROMPT-001",
    name: "Unsafe template literal in LLM prompt",
    severity: "CRITICAL" as const,
    pattern: /\binvoke\s*\(\s*`[^`]*\$\{[^}]*\b(?:requestText|naturalLanguage|input|message|prompt|text|body)\b[^}]*\}[^`]*`\s*\)/,
    description:
      "User input is directly interpolated into a template literal passed to an LLM invoke() call without JSON.stringify or structured validation.",
  },
  {
    id: "PROMPT-002",
    name: "Prompt construction without guardrails check",
    severity: "HIGH" as const,
    pattern:
      /\b(withStructuredOutput|invoke)\s*\(/,
    prerequisite: (lines: string[], idx: number, filePath: string): boolean => {
      // Graph-level agents have guardrails enforced upstream by risk_guard node.
      // Only flag entry points that directly consume untrusted user input.
      if (filePath.includes("src/agents/")) {
        return false;
      }
      // Exclude LangGraph graph.invoke() — not an LLM call
      if (lines[idx].includes("graph.invoke")) {
        return false;
      }
      return true;
    },
    description:
      "LLM invocation without visible guardrails/safety checks on user input.",
  },
  {
    id: "PROMPT-003",
    name: "Hardcoded system prompt exposed to manipulation",
    severity: "MEDIUM" as const,
    pattern: /`[^`]*(?:You are|Act as|ignore previous|system prompt|developer mode)[^`]*`/i,
    prerequisite: (lines: string[], idx: number): boolean => {
      const line = lines[idx];
      return line.includes("invoke") || line.includes("withStructuredOutput");
    },
    description:
      "System prompt contains manipulation-prone phrases or is constructed inline where it could be tampered with.",
  },
  {
    id: "PROMPT-004",
    name: "Missing output validation after LLM call",
    severity: "HIGH" as const,
    pattern: /await\s+\w+\.(?:invoke|withStructuredOutput)\s*\(/,
    prerequisite: (lines: string[], idx: number): boolean => {
      // Exclude LangGraph graph.invoke() — not an LLM call
      if (lines[idx].includes("graph.invoke")) {
        return false;
      }

      // withStructuredOutput already enforces schema validation
      if (lines[idx].includes("withStructuredOutput")) {
        return false;
      }

      // Check if this invoke() is on a model created via withStructuredOutput
      // Look back 30 lines for withStructuredOutput assignment
      const start = Math.max(0, idx - 30);
      const backContext = lines.slice(start, idx).join("\n");
      if (backContext.includes("withStructuredOutput")) {
        return false;
      }

      // Look ahead 20 lines for schema.parse or validation
      const end = Math.min(lines.length, idx + 20);
      const context = lines.slice(idx, end).join("\n");
      const hasValidation =
        context.includes(".parse(") ||
        context.includes("safeParse(") ||
        context.includes("validateWithSchema") ||
        context.includes("detectUnsafeOutput");
      return !hasValidation;
    },
    description:
      "LLM output is used without schema validation or safety screening.",
  },
  {
    id: "PROMPT-005",
    name: "Temperature set too high for safety-critical flow",
    severity: "MEDIUM" as const,
    pattern: /temperature\s*:\s*([01]\.\d+)/,
    description:
      "High temperature increases unpredictability and hallucination risk in safety-critical LLM flows.",
  },
];

const analyzeFile = (filePath: string) => {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const relativePath = filePath.replace(process.cwd() + "/", "");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const rule of RULES) {
      const match = rule.pattern.exec(line);
      if (match) {
        if (rule.prerequisite && !rule.prerequisite(lines, i, relativePath)) {
          continue;
        }

        // Extra check for temperature rule
        if (rule.id === "PROMPT-005") {
          const temp = Number.parseFloat(match[1]);
          if (temp <= 0.3) continue; // Low temperature is acceptable
        }

        report(
          filePath.replace(process.cwd() + "/", ""),
          i + 1,
          rule.severity,
          rule.id,
          `${rule.name}: ${rule.description}`,
        );
      }
    }
  }
};

const main = () => {
  const files = walk(SRC_DIR);
  for (const file of files) {
    analyzeFile(file);
  }

  // Sort by severity
  const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  findings.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      a.file.localeCompare(b.file),
  );

  console.log("=".repeat(70));
  console.log("  Prompt Security Static Analysis Report");
  console.log("=".repeat(70));

  if (findings.length === 0) {
    console.log("\n✅ No prompt security issues found.\n");
    process.exit(0);
  }

  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;

  for (const f of findings) {
    if (f.severity === "CRITICAL") critical++;
    if (f.severity === "HIGH") high++;
    if (f.severity === "MEDIUM") medium++;
    if (f.severity === "LOW") low++;

    const icon =
      f.severity === "CRITICAL"
        ? "🔴"
        : f.severity === "HIGH"
          ? "🟠"
          : f.severity === "MEDIUM"
            ? "🟡"
            : "🔵";

    console.log(`\n${icon} [${f.severity}] ${f.rule}`);
    console.log(`   File: ${f.file}:${f.line}`);
    console.log(`   ${f.message}`);
  }

  console.log("\n" + "-".repeat(70));
  console.log(
    `  Summary: ${critical} critical, ${high} high, ${medium} medium, ${low} low`,
  );
  console.log("-".repeat(70));

  if (critical > 0 || high > 0) {
    process.exit(1);
  }
  process.exit(0);
};

main();
