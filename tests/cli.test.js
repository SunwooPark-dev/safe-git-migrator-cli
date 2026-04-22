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

test("wiki-bootstrap creates a CLI wiki scaffold and updates README", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-wiki-cli-"));
  writeFile(path.join(tempDir, "README.md"), "# Example CLI\n");

  const report = await executeMigration("wiki-bootstrap", tempDir, {
    template: "cli",
  });

  assert.equal(report.command, "wiki-bootstrap");
  assert.equal(report.template, "cli");
  assert.ok(fs.existsSync(path.join(tempDir, "docs", "wiki", "Home.md")));
  assert.ok(fs.existsSync(path.join(tempDir, "docs", "wiki", "Install-and-Run.md")));
  assert.ok(report.createdFiles.some((file) => file.endsWith(path.join("docs", "wiki", "Home.md"))));

  const readme = fs.readFileSync(path.join(tempDir, "README.md"), "utf8");
  assert.match(readme, /docs\/wiki\/Home\.md/);
  assert.equal(report.readmeUpdated, true);
});

test("wiki-bootstrap is idempotent and can create an adapter wiki scaffold", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-wiki-adapter-"));
  writeFile(path.join(tempDir, "README.md"), "# Example Adapter Repo\n");

  const first = await executeMigration("wiki-bootstrap", tempDir, {
    template: "adapter",
  });

  assert.ok(fs.existsSync(path.join(tempDir, "docs", "wiki", "Quick-Start.md")));
  assert.ok(fs.existsSync(path.join(tempDir, "docs", "wiki", "Validation-System.md")));
  assert.equal(first.readmeUpdated, true);

  const second = await executeMigration("wiki-bootstrap", tempDir, {
    template: "adapter",
  });

  assert.equal(second.readmeUpdated, false);
  assert.ok(second.skippedFiles.length >= first.createdFiles.length);
});

test("wiki-register appends a build entry to an existing wiki", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-register-existing-"));
  writeFile(path.join(tempDir, "README.md"), "# Example Project\n");

  await executeMigration("wiki-bootstrap", tempDir, {
    template: "cli",
  });

  const report = await executeMigration("wiki-register", tempDir, {
    title: "Add homepage analytics",
    summary: "Tracked homepage usage and documented the verification flow.",
    files: "src/index.ts,docs/wiki/Home.md",
    verification: "npm test; npm run build",
  });

  assert.equal(report.command, "wiki-register");
  assert.equal(report.entryTitle, "Add homepage analytics");
  assert.ok(fs.existsSync(path.join(tempDir, "docs", "wiki", "Build-Registry.md")));
  const registry = fs.readFileSync(path.join(tempDir, "docs", "wiki", "Build-Registry.md"), "utf8");
  assert.match(registry, /Add homepage analytics/);
  assert.match(registry, /Tracked homepage usage/);
  assert.match(registry, /src\/index\.ts|src\\index\.ts/);
  assert.match(registry, /npm test/);
});

test("wiki-register creates a minimal wiki registry if none exists", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-register-bare-"));
  writeFile(path.join(tempDir, "README.md"), "# Bare Project\n");

  const report = await executeMigration("wiki-register", tempDir, {
    title: "Initial import",
    summary: "Imported baseline assets into the project.",
  });

  assert.equal(report.command, "wiki-register");
  assert.ok(fs.existsSync(path.join(tempDir, "docs", "wiki", "Home.md")));
  assert.ok(fs.existsSync(path.join(tempDir, "docs", "wiki", "Build-Registry.md")));
  const home = fs.readFileSync(path.join(tempDir, "docs", "wiki", "Home.md"), "utf8");
  assert.match(home, /Build Registry/);
});
