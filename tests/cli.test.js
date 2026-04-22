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

test("wiki-register does not inject generic architecture pages into an existing adapter wiki", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-register-adapter-existing-"));
  writeFile(path.join(tempDir, "README.md"), "# Adapter Repo\n");

  await executeMigration("wiki-bootstrap", tempDir, {
    template: "adapter",
  });

  const report = await executeMigration("wiki-register", tempDir, {
    title: "Adapter update",
    summary: "Registered an adapter-side change.",
    template: "adapter",
  });

  assert.equal(report.command, "wiki-register");
  assert.equal(fs.existsSync(path.join(tempDir, "docs", "wiki", "Architecture.md")), false);
});

test("wiki-audit passes for a bootstrapped and registered cli project", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-audit-cli-"));
  writeFile(path.join(tempDir, "README.md"), "# Example CLI\n");

  await executeMigration("wiki-bootstrap", tempDir, {
    template: "cli",
  });
  await executeMigration("wiki-register", tempDir, {
    title: "Initial setup",
    summary: "Bootstrapped the CLI wiki and verified setup.",
  });

  const report = await executeMigration("wiki-audit", tempDir, {
    template: "cli",
  });

  assert.equal(report.command, "wiki-audit");
  assert.equal(report.status, "pass");
  assert.equal(report.readmePointerPresent, true);
  assert.equal(report.buildRegistryPresent, true);
  assert.deepEqual(report.missingFiles, []);
});

test("wiki-audit fails when required consumer handoffs are missing", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-audit-adapter-"));
  writeFile(path.join(tempDir, "README.md"), "# Example Adapter Repo\n");

  await executeMigration("wiki-bootstrap", tempDir, {
    template: "adapter",
  });

  const report = await executeMigration("wiki-audit", tempDir, {
    template: "adapter",
    consumers: "codex,antigravity,gemini",
  });

  assert.equal(report.command, "wiki-audit");
  assert.equal(report.status, "fail");
  assert.ok(report.missingHandoffs.some((file) => file.endsWith("HANDOFF_TO_CODEX_APP.md")));
  assert.ok(report.missingHandoffs.some((file) => file.endsWith("HANDOFF_TO_ANTIGRAVITY_APP.md")));
  assert.ok(report.missingHandoffs.some((file) => file.endsWith("HANDOFF_TO_GEMINI_TERMINAL.md")));
});

test("wiki-audit does not create a missing target root", async () => {
  const missingRoot = path.join(os.tmpdir(), `sgm-audit-missing-${Date.now()}`);
  fs.rmSync(missingRoot, { recursive: true, force: true });

  const report = await executeMigration("wiki-audit", missingRoot, {
    template: "cli",
  });

  assert.equal(report.command, "wiki-audit");
  assert.equal(report.status, "fail");
  assert.equal(report.targetExists, false);
  assert.equal(fs.existsSync(missingRoot), false);
});

test("wiki-audit fails on unknown consumer values instead of silently ignoring them", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-audit-consumers-"));
  writeFile(path.join(tempDir, "README.md"), "# Example Adapter Repo\n");

  await executeMigration("wiki-bootstrap", tempDir, {
    template: "adapter",
  });

  const report = await executeMigration("wiki-audit", tempDir, {
    template: "adapter",
    consumers: "codex,ag",
  });

  assert.equal(report.command, "wiki-audit");
  assert.equal(report.status, "fail");
  assert.deepEqual(report.unknownConsumers, ["ag"]);
});

test("wiki-finalize creates a release checklist and records final verification", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-finalize-cli-"));
  writeFile(path.join(tempDir, "README.md"), "# Example CLI\n");

  await executeMigration("wiki-bootstrap", tempDir, {
    template: "cli",
  });

  const report = await executeMigration("wiki-finalize", tempDir, {
    template: "cli",
    summary: "CLI is ready for internal beta use.",
    verification: "npm test; npm run build",
    risks: "No GitHub Wiki sync automation yet.",
    "manual-steps": "Review PR before release.",
    consumers: "codex",
  });

  assert.equal(report.command, "wiki-finalize");
  assert.equal(report.status, "ok");
  assert.ok(fs.existsSync(path.join(tempDir, "docs", "wiki", "Release-Checklist.md")));

  const checklist = fs.readFileSync(path.join(tempDir, "docs", "wiki", "Release-Checklist.md"), "utf8");
  assert.match(checklist, /CLI is ready for internal beta use/);
  assert.match(checklist, /npm test/);
  assert.match(checklist, /No GitHub Wiki sync automation yet/);
  assert.match(checklist, /Review PR before release/);

  const registry = fs.readFileSync(path.join(tempDir, "docs", "wiki", "Build-Registry.md"), "utf8");
  assert.match(registry, /Finalize project state/);
});

test("wiki-finalize respects an existing adapter wiki shape", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-finalize-adapter-"));
  writeFile(path.join(tempDir, "README.md"), "# Example Adapter Repo\n");

  await executeMigration("wiki-bootstrap", tempDir, {
    template: "adapter",
  });

  const report = await executeMigration("wiki-finalize", tempDir, {
    template: "adapter",
    summary: "Adapter repo handoffs are complete.",
    consumers: "codex,antigravity,gemini",
  });

  assert.equal(report.command, "wiki-finalize");
  assert.ok(fs.existsSync(path.join(tempDir, "docs", "wiki", "Release-Checklist.md")));
  assert.equal(fs.existsSync(path.join(tempDir, "docs", "wiki", "Architecture.md")), false);
});

test("wiki-handoff creates consumer handoff pages and links them from home", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-handoff-adapter-"));
  writeFile(path.join(tempDir, "README.md"), "# Example Adapter Repo\n");

  await executeMigration("wiki-bootstrap", tempDir, {
    template: "adapter",
  });

  const report = await executeMigration("wiki-handoff", tempDir, {
    template: "adapter",
    consumers: "codex,antigravity",
    "repo-url": "https://github.com/example/repo",
    branch: "main",
  });

  assert.equal(report.command, "wiki-handoff");
  assert.ok(fs.existsSync(path.join(tempDir, "docs", "wiki", "HANDOFF_TO_CODEX_APP.md")));
  assert.ok(fs.existsSync(path.join(tempDir, "docs", "wiki", "HANDOFF_TO_ANTIGRAVITY_APP.md")));

  const home = fs.readFileSync(path.join(tempDir, "docs", "wiki", "Home.md"), "utf8");
  assert.match(home, /Handoff to Codex App/);
  assert.match(home, /Handoff to Antigravity App/);
});

test("wiki-handoff can bootstrap a bare cli repo and fails on unknown consumer names", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-handoff-cli-"));
  writeFile(path.join(tempDir, "README.md"), "# Example CLI\n");

  const okReport = await executeMigration("wiki-handoff", tempDir, {
    template: "cli",
    consumers: "gemini",
  });

  assert.equal(okReport.command, "wiki-handoff");
  assert.ok(fs.existsSync(path.join(tempDir, "docs", "wiki", "HANDOFF_TO_GEMINI_TERMINAL.md")));

  const badReport = await executeMigration("wiki-handoff", tempDir, {
    template: "cli",
    consumers: "ag",
  });

  assert.equal(badReport.status, "fail");
  assert.deepEqual(badReport.unknownConsumers, ["ag"]);
});

test("recommend suggests wiki-bootstrap for a new project start", async () => {
  const missingRoot = path.join(os.tmpdir(), `sgm-recommend-new-${Date.now()}`);
  fs.rmSync(missingRoot, { recursive: true, force: true });

  const report = await executeMigration("recommend", missingRoot, {
    task: "새 프로젝트 시작할게. 위키부터 잡고 싶어.",
    template: "cli",
  });

  assert.equal(report.command, "recommend");
  assert.equal(report.recommendation.kind, "cli");
  assert.equal(report.recommendation.id, "wiki-bootstrap");
});

test("recommend suggests wiki-register after meaningful implementation when registry is missing", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-recommend-register-"));
  writeFile(path.join(tempDir, "README.md"), "# Example Adapter Repo\n");

  await executeMigration("wiki-bootstrap", tempDir, {
    template: "adapter",
  });

  const report = await executeMigration("recommend", tempDir, {
    task: "기능 구현이 끝났어. 이제 무엇을 해야 하지?",
    template: "adapter",
  });

  assert.equal(report.command, "recommend");
  assert.equal(report.recommendation.kind, "cli");
  assert.equal(report.recommendation.id, "wiki-register");
});

test("recommend suggests wiki-handoff when consumer handoffs are missing", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-recommend-handoff-"));
  writeFile(path.join(tempDir, "README.md"), "# Example Adapter Repo\n");

  await executeMigration("wiki-bootstrap", tempDir, {
    template: "adapter",
  });
  await executeMigration("wiki-register", tempDir, {
    template: "adapter",
    title: "Initial import",
    summary: "Imported baseline assets.",
  });

  const report = await executeMigration("recommend", tempDir, {
    task: "이제 Codex랑 Gemini에 넘겨야 해.",
    template: "adapter",
    consumers: "codex,gemini",
  });

  assert.equal(report.command, "recommend");
  assert.equal(report.recommendation.kind, "cli");
  assert.equal(report.recommendation.id, "wiki-handoff");
});

test("recommend can suggest a skill when the task is clearly a review request", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-recommend-skill-"));
  writeFile(path.join(tempDir, "README.md"), "# Example Repo\n");

  const report = await executeMigration("recommend", tempDir, {
    task: "코드 리뷰해줘. 머지 전에 점검하고 싶어.",
    template: "cli",
  });

  assert.equal(report.command, "recommend");
  assert.equal(report.recommendation.kind, "skill");
  assert.equal(report.recommendation.id, "code-review");
});
