#!/usr/bin/env node
/*
 * One-command release for @pengpeng6845/dsh-balance.
 *
 * Usage:  node scripts/release.mjs <version> [changelog summary]
 * Example: node scripts/release.mjs 0.7.1 "Fix sidebar refresh on tab restore"
 *
 * Steps: clean-tree check -> version bump -> CHANGELOG entry -> tests ->
 * commit -> tag -> push -> GitHub Release (when GH_TOKEN is exported).
 * Zero dependencies: node builtins only.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
const summary = process.argv[3] ?? "(no summary given)";
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("usage: node scripts/release.mjs <x.y.z> [summary]");
  process.exit(1);
}

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// 1. clean tree, on main
const status = run("git status --porcelain");
if (status !== "") {
  console.error("working tree is not clean — commit or stash first");
  process.exit(1);
}
const branch = run("git branch --show-current");
if (branch !== "main") {
  console.error("releases must run on main (current: " + branch + ")");
  process.exit(1);
}

// 2. bump version
const pkgPath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (pkg.version === version) {
  console.error("version already " + version);
  process.exit(1);
}
const oldVersion = pkg.version;
console.log("release " + oldVersion + " -> " + version);
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// 3. changelog entry (prepend above the previous version header)
const changePath = new URL("../CHANGELOG.md", import.meta.url);
const changelog = readFileSync(changePath, "utf8");
const today = new Date().toISOString().slice(0, 10);
const header = "## [" + version + "] - " + today + "\n\n### Changed\n\n- " + summary + "\n\n";
const idx = changelog.indexOf("## [" + oldVersion + "]");
if (idx === -1) {
  console.error("CHANGELOG marker for " + oldVersion + " not found");
  process.exit(1);
}
writeFileSync(changePath, changelog.slice(0, idx) + header + changelog.slice(idx));

// 4. tests
run("node test/smoke.mjs");

// 5. commit + tag + push
run("git add package.json CHANGELOG.md");
run('git commit -m "release ' + version + '"');
run("git tag v" + version);
run("git push origin main");
run("git push origin v" + version);

// 6. GitHub release (optional token)
const token = process.env.GH_TOKEN;
if (token) {
  const repo = run("git remote get-url origin").match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
  const resp = await fetch("https://api.github.com/repos/" + repo + "/releases", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "user-agent": "dsh-balance-release",
      accept: "application/vnd.github+json",
    },
    body: JSON.stringify({ tag_name: "v" + version, name: "v" + version, body: summary }),
  });
  console.log("release: HTTP " + resp.status);
} else {
  console.log("done — GH_TOKEN not set, skipped GitHub Release creation");
}
console.log("released " + version);
