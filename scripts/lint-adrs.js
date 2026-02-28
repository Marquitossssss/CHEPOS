#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const adrDir = path.join(repoRoot, "docs", "adr");
const traceabilityPath = path.join(adrDir, "TRACEABILITY.md");

const REQUIRED_HEADERS = [
  "## Context",
  "## Decision",
  "## Decision Drivers",
  "## Consequences",
  "## Failure Modes",
  "## Operational Playbook",
  "## Audit Evidence",
  "## Metrics / SLIs",
  "## Rollback Plan",
  "## Related ADRs",
  "## Affected Modules"
];

function fail(msg) {
  console.error(`ADR-LINT ERROR: ${msg}`);
  process.exitCode = 1;
}

function read(p) {
  return fs.readFileSync(p, "utf8");
}

if (!fs.existsSync(adrDir)) {
  fail("docs/adr directory is missing");
  process.exit(process.exitCode || 1);
}

const files = fs
  .readdirSync(adrDir)
  .filter((f) => /^ADR-\d+\.md$/i.test(f))
  .sort();

if (files.length === 0) {
  fail("no ADR-*.md files found in docs/adr");
}

const traceability = fs.existsSync(traceabilityPath) ? read(traceabilityPath) : "";

for (const file of files) {
  const fullPath = path.join(adrDir, file);
  const text = read(fullPath);

  const statusMatch = text.match(/-\s*Status:\s*(.+)/i);
  if (!statusMatch) {
    fail(`${file}: missing '- Status:' metadata`);
  } else {
    const status = statusMatch[1].trim();
    if (!["Proposed", "Accepted", "Deprecated"].includes(status)) {
      fail(`${file}: invalid Status '${status}' (expected Proposed|Accepted|Deprecated)`);
    }
  }

  for (const header of REQUIRED_HEADERS) {
    if (!text.includes(header)) {
      fail(`${file}: missing required section '${header}'`);
    }
  }

  if (!traceability.includes(file.replace(/\.md$/i, ""))) {
    fail(`${file}: not referenced in docs/adr/TRACEABILITY.md`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`ADR-LINT OK: ${files.length} ADR files checked.`);
