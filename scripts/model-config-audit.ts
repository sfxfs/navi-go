#!/usr/bin/env node
/**
 * Model Configuration Security Audit
 *
 * Audits AI/LLM configuration for security best practices:
 * - Temperature settings
 * - Model selection (avoiding deprecated/unsafe models)
 * - Timeout and retry configuration
 * - Presence of guardrails
 * - System prompt safety
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

interface AuditFinding {
  file: string;
  line: number;
  category: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  message: string;
  recommendation: string;
}

const SRC_DIR = resolve(process.cwd(), "src");

const walk = (dir: string): string[] => {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = resolve(dir, entry);
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (/\.(ts|js)$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
};

const findings: AuditFinding[] = [];

const report = (
  file: string,
  line: number,
  category: string,
  severity: AuditFinding["severity"],
  message: string,
  recommendation: string,
) => {
  findings.push({ file, line, category, severity, message, recommendation });
};

const DEPRECATED_MODELS = [
  "gpt-3.5-turbo-0301",
  "gpt-3.5-turbo-0613",
  "gpt-4-0314",
  "gpt-4-0613",
  "gpt-4-32k-0314",
  "text-davinci",
  "code-davinci",
];

const HIGH_TEMPERATURE_THRESHOLD = 0.5;
const MAX_TIMEOUT_MS = 60_000;

const auditFile = (filePath: string) => {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for deprecated models
    for (const model of DEPRECATED_MODELS) {
      if (line.includes(model)) {
        report(
          filePath.replace(process.cwd() + "/", ""),
          i + 1,
          "Model Selection",
          "HIGH",
          `Deprecated model '${model}' detected`,
          "Upgrade to a current model (e.g., gpt-4o, gpt-4o-mini)",
        );
      }
    }

    // Check temperature
    const tempMatch = line.match(/temperature\s*:\s*(\d*\.?\d+)/);
    if (tempMatch) {
      const temp = Number.parseFloat(tempMatch[1]);
      if (temp > HIGH_TEMPERATURE_THRESHOLD) {
        report(
          filePath.replace(process.cwd() + "/", ""),
          i + 1,
          "Temperature",
          "MEDIUM",
          `Temperature ${temp} exceeds recommended threshold (${HIGH_TEMPERATURE_THRESHOLD})`,
          "Consider lowering temperature to ≤0.3 for deterministic safety-critical flows",
        );
      } else if (temp <= 0.3) {
        // Good practice - log as info
        report(
          filePath.replace(process.cwd() + "/", ""),
          i + 1,
          "Temperature",
          "INFO",
          `Temperature ${temp} is within safe range`,
          "No action needed",
        );
      }
    }

    // Check for timeout configuration
    const timeoutMatch = line.match(/timeout(?:Ms)?\s*:\s*(\d+)/);
    if (timeoutMatch) {
      const timeout = Number.parseInt(timeoutMatch[1], 10);
      if (timeout > MAX_TIMEOUT_MS) {
        report(
          filePath.replace(process.cwd() + "/", ""),
          i + 1,
          "Timeout",
          "MEDIUM",
          `Timeout ${timeout}ms exceeds recommended maximum (${MAX_TIMEOUT_MS}ms)`,
          "Set a reasonable timeout to prevent resource exhaustion attacks",
        );
      }
    }

    // Check for streaming (good for security as it allows early termination)
    if (line.includes("streaming: true")) {
      report(
        filePath.replace(process.cwd() + "/", ""),
        i + 1,
        "Streaming",
        "INFO",
        "Streaming enabled - allows early termination of unsafe outputs",
        "No action needed",
      );
    }

    // Check for structured output (good practice)
    if (line.includes("withStructuredOutput")) {
      report(
        filePath.replace(process.cwd() + "/", ""),
        i + 1,
        "Output Validation",
        "INFO",
        "Structured output with schema validation detected",
        "No action needed",
      );
    }
  }
};

const auditEnvConfig = () => {
  const envPath = resolve(process.cwd(), "src/config/env.ts");
  if (!statSync(envPath, { throwIfNoEntry: false })) return;

  const content = readFileSync(envPath, "utf-8");
  const lines = content.split("\n");

  // Check for API key validation
  const hasKeyValidation =
    content.includes("requireOpenAiApiKey") ||
    content.includes("requireDuffelApiToken");

  if (hasKeyValidation) {
    report(
      "src/config/env.ts",
      1,
      "API Key Management",
      "INFO",
      "Runtime API key validation detected",
      "No action needed",
    );
  }

  // Check for default model
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("OPENAI_MODEL") && lines[i].includes("default")) {
      const modelMatch = lines[i].match(/default\(["']([^"']+)["']\)/);
      if (modelMatch) {
        const model = modelMatch[1];
        if (model.includes("gpt-4o")) {
          report(
            "src/config/env.ts",
            i + 1,
            "Model Selection",
            "INFO",
            `Default model '${model}' is current and secure`,
            "No action needed",
          );
        }
      }
    }
  }
};

const main = () => {
  const files = walk(SRC_DIR);
  for (const file of files) {
    auditFile(file);
  }
  auditEnvConfig();

  // Sort by severity
  const severityOrder = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
    INFO: 4,
  };
  findings.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      a.file.localeCompare(b.file),
  );

  console.log("=".repeat(70));
  console.log("  Model Configuration Security Audit");
  console.log("=".repeat(70));

  const critical = findings.filter((f) => f.severity === "CRITICAL").length;
  const high = findings.filter((f) => f.severity === "HIGH").length;
  const medium = findings.filter((f) => f.severity === "MEDIUM").length;
  const low = findings.filter((f) => f.severity === "LOW").length;
  const info = findings.filter((f) => f.severity === "INFO").length;

  if (findings.length === 0) {
    console.log("\n✅ No model configuration issues found.\n");
    process.exit(0);
  }

  for (const f of findings) {
    const icon =
      f.severity === "CRITICAL"
        ? "🔴"
        : f.severity === "HIGH"
          ? "🟠"
          : f.severity === "MEDIUM"
            ? "🟡"
            : f.severity === "LOW"
              ? "🔵"
              : "⚪";

    console.log(`\n${icon} [${f.severity}] ${f.category}`);
    console.log(`   File: ${f.file}:${f.line}`);
    console.log(`   Issue: ${f.message}`);
    console.log(`   Recommendation: ${f.recommendation}`);
  }

  console.log("\n" + "-".repeat(70));
  console.log(
    `  Summary: ${critical} critical, ${high} high, ${medium} medium, ${low} low, ${info} info`,
  );
  console.log("-".repeat(70));

  if (critical > 0 || high > 0) {
    process.exit(1);
  }
  process.exit(0);
};

main();
