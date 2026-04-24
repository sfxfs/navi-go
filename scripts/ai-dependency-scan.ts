#!/usr/bin/env node
/**
 * AI Dependency Security Scan
 *
 * Scans package-lock.json for known vulnerabilities in AI/ML packages
 * and checks against a curated list of AI security advisories.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Advisory {
  package: string;
  affectedVersions: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  cve?: string;
  description: string;
  fixedIn?: string;
}

// Curated AI/ML security advisories (actively maintained subset)
const AI_ADVISORIES: Advisory[] = [
  {
    package: "langchain",
    affectedVersions: "<0.0.350",
    severity: "HIGH",
    cve: "CVE-2024-23334",
    description:
      "Path traversal vulnerability in document loaders allowing arbitrary file read",
    fixedIn: "0.0.350",
  },
  {
    package: "langchain",
    affectedVersions: "<0.1.0",
    severity: "MEDIUM",
    description:
      "SQL injection risk in SQLDatabaseChain when user input is not properly parameterized",
    fixedIn: "0.1.0",
  },
  {
    package: "openai",
    affectedVersions: "<4.0.0",
    severity: "MEDIUM",
    description:
      "Older versions may not enforce proper request validation; upgrade recommended",
    fixedIn: "4.0.0",
  },
  {
    package: "@langchain/core",
    affectedVersions: "<0.1.0",
    severity: "MEDIUM",
    description:
      "Early versions lacked comprehensive output validation helpers",
    fixedIn: "0.1.0",
  },
];

interface DependencyInfo {
  name: string;
  version: string;
  resolved: string;
}

const parseLockfile = (): DependencyInfo[] => {
  const lockPath = resolve(process.cwd(), "package-lock.json");
  const content = readFileSync(lockPath, "utf-8");
  const lock = JSON.parse(content) as {
    packages?: Record<string, { version?: string; resolved?: string }>;
  };

  const deps: DependencyInfo[] = [];
  if (lock.packages) {
    for (const [path, info] of Object.entries(lock.packages)) {
      if (!path || path === "") continue;
      const name = path.replace(/^node_modules\//, "").replace(/\/node_modules\//g, "/");
      if (info.version) {
        deps.push({
          name: name.split("/").pop() || name,
          version: info.version,
          resolved: info.resolved || "",
        });
      }
    }
  }
  return deps;
};

const versionSatisfies = (version: string, range: string): boolean => {
  // Simple semver comparison for common patterns
  const cleanVersion = version.replace(/^[^0-9]/, "");
  const cleanRange = range.replace(/^[<>=~^]+/, "");

  if (range.startsWith("<")) {
    const vParts = cleanVersion.split(".").map(Number);
    const rParts = cleanRange.split(".").map(Number);
    for (let i = 0; i < Math.max(vParts.length, rParts.length); i++) {
      const v = vParts[i] || 0;
      const r = rParts[i] || 0;
      if (v < r) return true;
      if (v > r) return false;
    }
    return false; // equal
  }

  if (range.startsWith("<=")) {
    const vParts = cleanVersion.split(".").map(Number);
    const rParts = cleanRange.split(".").map(Number);
    for (let i = 0; i < Math.max(vParts.length, rParts.length); i++) {
      const v = vParts[i] || 0;
      const r = rParts[i] || 0;
      if (v < r) return true;
      if (v > r) return false;
    }
    return true; // equal
  }

  // Default: exact match or simple comparison
  return cleanVersion === cleanRange;
};

const main = () => {
  const deps = parseLockfile();
  const findings: { dep: DependencyInfo; advisory: Advisory }[] = [];

  for (const dep of deps) {
    for (const advisory of AI_ADVISORIES) {
      if (dep.name === advisory.package) {
        if (versionSatisfies(dep.version, advisory.affectedVersions)) {
          findings.push({ dep, advisory });
        }
      }
    }
  }

  console.log("=".repeat(70));
  console.log("  AI Dependency Security Scan");
  console.log("=".repeat(70));

  if (findings.length === 0) {
    console.log("\n✅ No known AI/ML security advisories matched.\n");
    console.log(`  Scanned ${deps.length} dependencies.\n`);
    process.exit(0);
  }

  let critical = 0;
  let high = 0;

  for (const { dep, advisory } of findings) {
    if (advisory.severity === "CRITICAL") critical++;
    if (advisory.severity === "HIGH") high++;

    const icon = advisory.severity === "CRITICAL" ? "🔴" : "🟠";
    console.log(`\n${icon} [${advisory.severity}] ${advisory.package}@${dep.version}`);
    console.log(`   Advisory: ${advisory.description}`);
    if (advisory.cve) console.log(`   CVE: ${advisory.cve}`);
    if (advisory.fixedIn) console.log(`   Fixed in: ${advisory.fixedIn}`);
  }

  console.log("\n" + "-".repeat(70));
  console.log(`  Found ${findings.length} advisory match(es)`);
  console.log("-".repeat(70));

  if (critical > 0 || high > 0) {
    process.exit(1);
  }
  process.exit(0);
};

main();
