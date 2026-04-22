const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const { pathToFileURL } = require("node:url");

const { executeMigration, normalizeSource, classifyArtifacts, enforceMitOnly } = require("../src/lib/runner");

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

function createFixtureSource(rootDir) {
  writeFile(
    path.join(rootDir, "LICENSE"),
    `MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.`
  );
  writeFile(path.join(rootDir, "AGENTS.md"), "# Guidance\n");
  writeFile(path.join(rootDir, "skills", "example-skill", "SKILL.md"), "# Example skill\n");
  writeFile(path.join(rootDir, "skills", "example-skill", "extra.txt"), "hello\n");
  writeFile(path.join(rootDir, "prompts", "starter.prompt"), "prompt text\n");
  writeFile(path.join(rootDir, ".github", "workflows", "ci.yml"), "name: ci\n");
  writeFile(path.join(rootDir, "scripts", "setup.sh"), "echo hi\n");
}

function git(cwd, args) {
  const result = cp.spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
}

test("normalizeSource supports local paths", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-local-"));
  const source = normalizeSource(tempDir);
  assert.equal(source.kind, "local");
  assert.equal(source.provider, "local");
});

test("enforceMitOnly passes on MIT fixture", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-license-"));
  createFixtureSource(tempDir);
  const result = enforceMitOnly(tempDir);
  assert.equal(result.ok, true);
});

test("classifyArtifacts finds skill bundles and partial scripts", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-classify-"));
  createFixtureSource(tempDir);
  const artifacts = classifyArtifacts(tempDir);
  assert.ok(artifacts.some((item) => item.type === "skill-bundle"));
  assert.ok(artifacts.some((item) => item.status === "partial"));
});

test("dry-run creates reports without installing", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-dry-"));
  const sourceDir = path.join(tempDir, "source");
  createFixtureSource(sourceDir);

  const report = await executeMigration("dry-run", sourceDir, {
    workspace: path.join(tempDir, "workspace"),
    targets: "codex,omx",
  });

  assert.equal(report.license.ok, true);
  assert.equal(report.install.mode, "skipped");
  assert.equal(report.targets.length, 2);
});

test("inspect produces a report without transform outputs", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-inspect-"));
  const sourceDir = path.join(tempDir, "source");
  const workspace = path.join(tempDir, "workspace");
  createFixtureSource(sourceDir);

  const report = await executeMigration("inspect", sourceDir, {
    workspace,
    targets: "codex,omx",
  });

  assert.equal(report.license.ok, true);
  assert.equal(report.install.mode, "skipped");
  assert.equal(report.targets.length, 0);
  assert.equal(fs.existsSync(path.join(workspace, "runs", report.runId, "outputs")), false);
  assert.equal(fs.existsSync(path.join(workspace, "runs", report.runId, "source-manifest.json")), true);
});

test("inspect works even when workspace is nested inside the local source tree", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-nested-"));
  createFixtureSource(tempDir);
  const workspace = path.join(tempDir, "workspace");

  const report = await executeMigration("inspect", tempDir, {
    workspace,
    targets: "codex",
  });

  assert.equal(report.license.ok, true);
  assert.equal(fs.existsSync(path.join(workspace, "runs", report.runId, "source-manifest.json")), true);
});

test("apply, verify, and rollback work against temp install roots", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-apply-"));
  const sourceDir = path.join(tempDir, "source");
  createFixtureSource(sourceDir);
  const workspace = path.join(tempDir, "workspace");
  const codexRoot = path.join(tempDir, "codex-root");
  const omxRoot = path.join(tempDir, "omx-root");
  const hermesRoot = path.join(tempDir, "hermes-root");
  const antigravityRoot = path.join(tempDir, "antigravity-root");

  const applyReport = await executeMigration("apply", sourceDir, {
    workspace,
    targets: "codex,omx,hermes,antigravity",
    "install-root-codex": codexRoot,
    "install-root-omx": omxRoot,
    "install-root-hermes": hermesRoot,
    "install-root-antigravity": antigravityRoot,
  });

  assert.equal(applyReport.license.ok, true);
  assert.ok(fs.existsSync(path.join(codexRoot, "skills", "example-skill", "SKILL.md")));

  const runId = applyReport.runId;
  const verifyReport = await executeMigration("verify", runId, { workspace });
  assert.equal(verifyReport.ok, true);

  const rollbackReport = await executeMigration("rollback", runId, { workspace });
  assert.equal(rollbackReport.runId, runId);
  assert.equal(fs.existsSync(path.join(codexRoot, "skills", "example-skill", "SKILL.md")), false);
});

test("git sources use cached fetch and pick up upstream changes", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-fetch-"));
  const originDir = path.join(tempDir, "origin");
  const workspace = path.join(tempDir, "workspace");
  fs.mkdirSync(originDir, { recursive: true });
  git(originDir, ["init"]);
  git(originDir, ["config", "user.email", "test@example.com"]);
  git(originDir, ["config", "user.name", "Test User"]);
  createFixtureSource(originDir);
  git(originDir, ["add", "."]);
  git(originDir, ["commit", "-m", "initial"]);

  const sourceUrl = pathToFileURL(originDir).href;
  const first = await executeMigration("dry-run", sourceUrl, {
    workspace,
    targets: "codex",
  });
  assert.equal(first.license.ok, true);

  writeFile(path.join(originDir, "new-note.md"), "fresh content\n");
  git(originDir, ["add", "."]);
  git(originDir, ["commit", "-m", "update"]);

  const second = await executeMigration("dry-run", sourceUrl, {
    workspace,
    targets: "codex",
  });

  assert.ok(second.inventory.totalArtifacts > first.inventory.totalArtifacts);
});
