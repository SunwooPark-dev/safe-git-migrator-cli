const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const { pathToFileURL } = require("node:url");

const {
  executeMigration,
  normalizeSource,
  classifyArtifacts,
  enforceMitOnly,
  parseWikiBuildRegistry,
  runCli,
} = require("../src/lib/runner");

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

function writeBuildRegistry(rootDir, contents) {
  writeFile(path.join(rootDir, "docs", "wiki", "Build-Registry.md"), contents);
}

function cleanWikiRegistry() {
  return `# Build Registry

이 페이지는 프로젝트에서 실제로 만들어진 것과 그 검증 내용을 기록하는 canonical registry입니다.

## Added wiki scaffolding
- Recorded at: 2026-04-20T10:00:00.000Z
- Summary: Bootstrapped the wiki pages and linked the README.
- Files:
  - docs/wiki/Home.md
  - README.md
- Verification:
  - npm test
  - npm run build

## Registered release checklist
- Recorded at: 2026-04-21T10:00:00.000Z
- Summary: Added a release checklist for the beta handoff.
- Files:
  - docs/wiki/Release-Checklist.md
- Verification:
  - node --test
`;
}

async function captureConsoleLogs(fn) {
  const originalLog = console.log;
  const logs = [];
  console.log = (...args) => {
    logs.push(args.join(" "));
  };

  try {
    await fn();
    return logs;
  } finally {
    console.log = originalLog;
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

test("parseWikiBuildRegistry extracts entry fields split by level-two headings", () => {
  const entries = parseWikiBuildRegistry(cleanWikiRegistry());

  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    title: "Added wiki scaffolding",
    recordedAt: "2026-04-20T10:00:00.000Z",
    summary: "Bootstrapped the wiki pages and linked the README.",
    files: ["docs/wiki/Home.md", "README.md"],
    verification: ["npm test", "npm run build"],
  });
  assert.deepEqual(entries[1], {
    title: "Registered release checklist",
    recordedAt: "2026-04-21T10:00:00.000Z",
    summary: "Added a release checklist for the beta handoff.",
    files: ["docs/wiki/Release-Checklist.md"],
    verification: ["node --test"],
  });
});

test("wiki-mint dry-run reports parsed entry counts without writing files", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-mint-dry-"));
  writeBuildRegistry(tempDir, cleanWikiRegistry());

  const report = await executeMigration("wiki-mint", tempDir, {
    format: "readme-showcase",
    "dry-run": true,
  });

  assert.equal(report.command, "wiki-mint");
  assert.equal(report.mode, "dry-run");
  assert.equal(report.status, "ok");
  assert.equal(report.entryCount, 2);
  assert.equal(report.renderedEntryCount, 2);
  assert.equal(report.scan.blocked, false);
  assert.equal(fs.existsSync(path.join(tempDir, "docs", "wiki", "BUILD_SHOWCASE.md")), false);

  const registry = fs.readFileSync(path.join(tempDir, "docs", "wiki", "Build-Registry.md"), "utf8");
  assert.doesNotMatch(registry, /Knowledge Mint:/);
});

test("wiki-mint scan-only scans without generating output", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-mint-scan-"));
  writeBuildRegistry(tempDir, cleanWikiRegistry());

  const report = await executeMigration("wiki-mint", tempDir, {
    "scan-only": true,
  });

  assert.equal(report.command, "wiki-mint");
  assert.equal(report.mode, "scan-only");
  assert.equal(report.status, "ok");
  assert.equal(report.entryCount, 2);
  assert.equal(report.renderedEntryCount, 2);
  assert.equal(report.outputPath, path.join(tempDir, "docs", "wiki", "BUILD_SHOWCASE.md"));
  assert.equal(report.created, false);
  assert.equal(fs.existsSync(report.outputPath), false);
});

test("wiki-mint dry-run accepts x-thread format without attempting generation", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-mint-dry-x-thread-"));
  writeBuildRegistry(tempDir, cleanWikiRegistry());

  const report = await executeMigration("wiki-mint", tempDir, {
    format: "x-thread",
    "dry-run": true,
  });

  assert.equal(report.command, "wiki-mint");
  assert.equal(report.format, "x-thread");
  assert.equal(report.mode, "dry-run");
  assert.equal(report.status, "ok");
  assert.equal(report.entryCount, 2);
  assert.equal(report.renderedEntryCount, 2);
  assert.equal(report.scan.blocked, false);
  assert.equal(report.created, false);
  assert.equal(report.outputPath, path.join(tempDir, "docs", "wiki", "BUILD_THREAD.md"));
});

test("wiki-mint scan-only accepts substack format without attempting generation", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-mint-scan-substack-"));
  writeBuildRegistry(tempDir, cleanWikiRegistry());

  const report = await executeMigration("wiki-mint", tempDir, {
    format: "substack",
    "scan-only": true,
  });

  assert.equal(report.command, "wiki-mint");
  assert.equal(report.format, "substack");
  assert.equal(report.mode, "scan-only");
  assert.equal(report.status, "ok");
  assert.equal(report.entryCount, 2);
  assert.equal(report.renderedEntryCount, 2);
  assert.equal(report.scan.blocked, false);
  assert.equal(report.created, false);
  assert.equal(report.outputPath, path.join(tempDir, "docs", "wiki", "BUILD_SUBSTACK.html"));
});

test("wiki-mint readme-showcase writes the showcase and auto-registers the mint", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-mint-ok-"));
  writeBuildRegistry(tempDir, cleanWikiRegistry());

  const report = await executeMigration("wiki-mint", tempDir, {
    format: "readme-showcase",
  });

  assert.equal(report.command, "wiki-mint");
  assert.equal(report.status, "ok");
  assert.equal(report.created, true);
  assert.equal(report.outputFileName, "BUILD_SHOWCASE.md");
  assert.ok(fs.existsSync(report.outputPath));

  const showcase = fs.readFileSync(report.outputPath, "utf8");
  assert.match(showcase, /# .* Build Showcase/);
  assert.match(showcase, /> Source: docs\/wiki\/Build-Registry\.md/);
  assert.match(showcase, /## Statistics/);
  assert.match(showcase, /Added wiki scaffolding/);
  assert.match(showcase, /Registered release checklist/);

  const registry = fs.readFileSync(path.join(tempDir, "docs", "wiki", "Build-Registry.md"), "utf8");
  assert.match(registry, /Knowledge Mint: readme-showcase generated/);
  assert.match(registry, /wiki-mint --format readme-showcase/);
  assert.match(registry, /docs\/wiki\/BUILD_SHOWCASE\.md|docs\\wiki\\BUILD_SHOWCASE\.md/);
});

test("wiki-mint x-thread format writes a thread output and auto-registers the mint", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-mint-x-thread-"));
  writeBuildRegistry(tempDir, cleanWikiRegistry());

  const report = await executeMigration("wiki-mint", tempDir, {
    format: "x-thread",
  });

  assert.equal(report.status, "ok");
  assert.equal(report.created, true);
  assert.equal(report.outputFileName, "BUILD_THREAD.md");
  assert.ok(fs.existsSync(report.outputPath));

  const thread = fs.readFileSync(report.outputPath, "utf8");
  assert.match(thread, /build thread/);
  assert.match(thread, /1\/2 Added wiki scaffolding/);
  assert.match(thread, /2\/2 Registered release checklist/);

  const registry = fs.readFileSync(path.join(tempDir, "docs", "wiki", "Build-Registry.md"), "utf8");
  assert.match(registry, /Knowledge Mint: x-thread generated/);
  assert.match(registry, /wiki-mint --format x-thread/);
});

test("wiki-mint x-thread reports 280 character warnings without blocking generation", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-mint-x-thread-warning-"));
  writeBuildRegistry(
    tempDir,
    `# Build Registry

## Very long entry
- Recorded at: 2026-04-22T10:00:00.000Z
- Summary: ${"Long summary. ".repeat(40)}
- Files:
  - docs/wiki/Home.md
- Verification:
  - npm test
`
  );

  const report = await executeMigration("wiki-mint", tempDir, {
    format: "x-thread",
  });

  assert.equal(report.status, "ok");
  assert.equal(report.created, true);
  assert.ok(report.warnings.some((warning) => warning.includes("280")));
});

test("wiki-mint substack format writes escaped paste-ready HTML", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-mint-substack-"));
  writeBuildRegistry(
    tempDir,
    `# Build Registry

## Entry <One> & "Two"
- Recorded at: 2026-04-22T10:00:00.000Z
- Summary: Built <script>alert("x")</script> safely.
- Files:
  - docs/wiki/Home.md
- Verification:
  - npm test
`
  );

  const report = await executeMigration("wiki-mint", tempDir, {
    format: "substack",
  });

  assert.equal(report.status, "ok");
  assert.equal(report.created, true);
  assert.equal(report.outputFileName, "BUILD_SUBSTACK.html");

  const html = fs.readFileSync(report.outputPath, "utf8");
  assert.match(html, /<!doctype html>/);
  assert.match(html, /Entry &lt;One&gt; &amp; &quot;Two&quot;/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);

  const registry = fs.readFileSync(path.join(tempDir, "docs", "wiki", "Build-Registry.md"), "utf8");
  assert.match(registry, /Knowledge Mint: substack generated/);
});

test("wiki-mint date-range filters rendered entries inclusively", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-mint-date-range-"));
  writeBuildRegistry(tempDir, cleanWikiRegistry());

  const report = await executeMigration("wiki-mint", tempDir, {
    format: "readme-showcase",
    from: "2026-04-21",
    to: "2026-04-21",
  });

  assert.equal(report.entryCount, 2);
  assert.equal(report.renderedEntryCount, 1);

  const showcase = fs.readFileSync(report.outputPath, "utf8");
  assert.doesNotMatch(showcase, /Added wiki scaffolding/);
  assert.match(showcase, /Registered release checklist/);
  assert.match(showcase, /- Entries: 1/);
});

test("wiki-mint date filters support from-only and to-only bounds", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-mint-date-open-bounds-"));
  writeBuildRegistry(tempDir, cleanWikiRegistry());

  const fromOnly = await executeMigration("wiki-mint", tempDir, {
    format: "readme-showcase",
    from: "2026-04-21",
    "dry-run": true,
  });

  assert.equal(fromOnly.renderedEntryCount, 1);

  const toOnly = await executeMigration("wiki-mint", tempDir, {
    format: "readme-showcase",
    to: "2026-04-20",
    "dry-run": true,
  });

  assert.equal(toOnly.renderedEntryCount, 1);
});

test("wiki-mint date filters skip missing or invalid recordedAt values only when active", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-mint-date-invalid-recorded-at-"));
  writeBuildRegistry(
    tempDir,
    `# Build Registry

## Missing date entry
- Summary: No recorded date here.
- Files:
  - docs/wiki/Home.md
- Verification:
  - manual review

## Invalid date entry
- Recorded at: not-a-date
- Summary: Bad recorded date.
- Files:
  - docs/wiki/Bad.md
- Verification:
  - manual review

## Valid date entry
- Recorded at: 2026-04-22T10:00:00.000Z
- Summary: Good recorded date.
- Files:
  - docs/wiki/Good.md
- Verification:
  - npm test
`
  );

  const noFilter = await executeMigration("wiki-mint", tempDir, {
    format: "readme-showcase",
    "dry-run": true,
  });
  assert.equal(noFilter.renderedEntryCount, 3);

  const withFilter = await executeMigration("wiki-mint", tempDir, {
    format: "readme-showcase",
    from: "2026-04-22",
    to: "2026-04-22",
    "dry-run": true,
  });
  assert.equal(withFilter.renderedEntryCount, 1);
});

test("wiki-mint warns and skips generation when date filters match no renderable entries", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-mint-date-empty-selection-"));
  writeBuildRegistry(tempDir, cleanWikiRegistry());

  const report = await executeMigration("wiki-mint", tempDir, {
    format: "x-thread",
    from: "2026-05-01",
  });

  assert.equal(report.status, "warn");
  assert.equal(report.created, false);
  assert.equal(report.registryAppended, false);
  assert.equal(report.renderedEntryCount, 0);
  assert.ok(report.warnings.some((warning) => warning.includes("No renderable")));
  assert.equal(fs.existsSync(path.join(tempDir, "docs", "wiki", "BUILD_THREAD.md")), false);
});

test("wiki-mint rejects invalid date filters before writing", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-mint-invalid-date-"));
  writeBuildRegistry(tempDir, cleanWikiRegistry());

  await assert.rejects(
    executeMigration("wiki-mint", tempDir, {
      from: "2026-99-99",
    }),
    /Invalid --from date/
  );

  await assert.rejects(
    executeMigration("wiki-mint", tempDir, {
      from: "2026-04-22",
      to: "2026-04-21",
    }),
    /Invalid date range/
  );
});

test("wiki-mint reruns do not include prior mint-generated registry entries in showcase output or statistics", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-mint-rerun-safe-"));
  writeBuildRegistry(tempDir, cleanWikiRegistry());

  const first = await executeMigration("wiki-mint", tempDir, {
    format: "readme-showcase",
  });
  assert.equal(first.status, "ok");

  const second = await executeMigration("wiki-mint", tempDir, {
    format: "readme-showcase",
  });
  assert.equal(second.status, "ok");

  const showcase = fs.readFileSync(path.join(tempDir, "docs", "wiki", "BUILD_SHOWCASE.md"), "utf8");
  assert.doesNotMatch(showcase, /Knowledge Mint:/);
  assert.match(showcase, /- Entries: 2/);
  assert.match(showcase, /- File references: 3/);
  assert.match(showcase, /- Verification steps: 3/);

  const registry = fs.readFileSync(path.join(tempDir, "docs", "wiki", "Build-Registry.md"), "utf8");
  const parsedEntries = parseWikiBuildRegistry(registry);
  const mintEntries = parsedEntries.filter((entry) => entry.title === "Knowledge Mint: readme-showcase generated");
  assert.equal(mintEntries.length, 2);
  assert.deepEqual(
    mintEntries.map((entry) => entry.summary),
    [
      "Generated BUILD_SHOWCASE.md from 2 Build-Registry entries.",
      "Generated BUILD_SHOWCASE.md from 2 Build-Registry entries.",
    ]
  );
});

test("wiki-mint keeps non-generated Knowledge Mint entries in the showcase", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-mint-keep-manual-knowledge-mint-"));
  writeBuildRegistry(
    tempDir,
    `# Build Registry

이 페이지는 프로젝트에서 실제로 만들어진 것과 그 검증 내용을 기록하는 canonical registry입니다.

## Knowledge Mint: Project Setup & OMX Handoff
- Recorded at: 2026-04-22T20:09:43.320Z
- Summary: Designed wiki-mint pipeline and created a Codex handoff spec.
- Files:
  - docs/wiki/HANDOFF_TO_CODEX.md
- Verification:
  - implementation_plan.md approved by user

## SIH Phase 1
- Recorded at: 2026-04-22T16:48:09.569Z
- Summary: Created the initial schema and wiki structure.
- Files:
  - supabase/migrations/01_core_schema.sql
  - docs/wiki/Home.md
- Verification:
  - npm test
`
  );

  const report = await executeMigration("wiki-mint", tempDir, {
    format: "readme-showcase",
  });

  assert.equal(report.status, "ok");

  const showcase = fs.readFileSync(path.join(tempDir, "docs", "wiki", "BUILD_SHOWCASE.md"), "utf8");
  assert.match(showcase, /Knowledge Mint: Project Setup & OMX Handoff/);
  assert.match(showcase, /SIH Phase 1/);
  assert.match(showcase, /- Entries: 2/);

  const registry = fs.readFileSync(path.join(tempDir, "docs", "wiki", "Build-Registry.md"), "utf8");
  assert.match(registry, /Knowledge Mint: readme-showcase generated/);
});

test("wiki-mint keeps manual Knowledge Mint entries even when their title ends in generated", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-mint-keep-manual-generated-title-"));
  writeBuildRegistry(
    tempDir,
    `# Build Registry

이 페이지는 프로젝트에서 실제로 만들어진 것과 그 검증 내용을 기록하는 canonical registry입니다.

## Knowledge Mint: release notes generated
- Recorded at: 2026-04-22T20:09:43.320Z
- Summary: Manually documented the generated release notes workflow.
- Files:
  - docs/wiki/Release-Notes.md
- Verification:
  - manual editorial review

## SIH Phase 1
- Recorded at: 2026-04-22T16:48:09.569Z
- Summary: Created the initial schema and wiki structure.
- Files:
  - supabase/migrations/01_core_schema.sql
  - docs/wiki/Home.md
- Verification:
  - npm test
`
  );

  const report = await executeMigration("wiki-mint", tempDir, {
    format: "readme-showcase",
  });

  assert.equal(report.status, "ok");

  const showcase = fs.readFileSync(path.join(tempDir, "docs", "wiki", "BUILD_SHOWCASE.md"), "utf8");
  assert.match(showcase, /Knowledge Mint: release notes generated/);
  assert.match(showcase, /SIH Phase 1/);
  assert.match(showcase, /- Entries: 2/);

  const registry = fs.readFileSync(path.join(tempDir, "docs", "wiki", "Build-Registry.md"), "utf8");
  assert.match(registry, /Knowledge Mint: readme-showcase generated/);
});

test("wiki-mint warns on zero parsed entries and skips file creation", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-mint-empty-"));
  writeBuildRegistry(
    tempDir,
    `# Build Registry

이 페이지는 프로젝트에서 실제로 만들어진 것과 그 검증 내용을 기록하는 canonical registry입니다.
`
  );

  const report = await executeMigration("wiki-mint", tempDir, {
    format: "readme-showcase",
  });

  assert.equal(report.command, "wiki-mint");
  assert.equal(report.status, "warn");
  assert.equal(report.entryCount, 0);
  assert.equal(report.created, false);
  assert.equal(fs.existsSync(path.join(tempDir, "docs", "wiki", "BUILD_SHOWCASE.md")), false);
});

test("wiki-mint accepts supported non-readme formats even when the registry has zero entries", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-mint-empty-unsupported-format-"));
  writeBuildRegistry(
    tempDir,
    `# Build Registry

이 페이지는 프로젝트에서 실제로 만들어진 것과 그 검증 내용을 기록하는 canonical registry입니다.
`
  );

  const report = await executeMigration("wiki-mint", tempDir, {
    format: "x-thread",
  });

  assert.equal(report.status, "warn");
  assert.equal(report.created, false);
  assert.equal(fs.existsSync(path.join(tempDir, "docs", "wiki", "BUILD_THREAD.md")), false);
});

test("wiki-mint blocks sensitive content, reports offending entry, and sets CLI exit code on report-json", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-mint-block-"));
  writeBuildRegistry(
    tempDir,
    `# Build Registry

이 페이지는 프로젝트에서 실제로 만들어진 것과 그 검증 내용을 기록하는 canonical registry입니다.

## Secret-bearing entry
- Recorded at: 2026-04-21T13:00:00.000Z
- Summary: Captured token=abc123 during a local test run.
- Files:
  - docs/wiki/Home.md
- Verification:
  - echoed eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
`
  );

  const originalExitCode = process.exitCode;
  process.exitCode = 0;

  try {
    const logs = await captureConsoleLogs(async () => {
      await runCli(["wiki-mint", tempDir, "--report-json"]);
    });

    const output = logs.join("\n");
    const report = JSON.parse(output);

    assert.equal(process.exitCode, 1);
    assert.equal(report.command, "wiki-mint");
    assert.equal(report.status, "blocked");
    assert.equal(report.created, false);
    assert.equal(report.scan.blocked, true);
    assert.equal(report.scan.issues[0].title, "Secret-bearing entry");
    assert.ok(report.scan.issues[0].matches.includes("token="));
    assert.ok(report.scan.issues[0].matches.includes("jwt"));
    assert.equal(fs.existsSync(path.join(tempDir, "docs", "wiki", "BUILD_SHOWCASE.md")), false);

    const registry = fs.readFileSync(path.join(tempDir, "docs", "wiki", "Build-Registry.md"), "utf8");
    assert.doesNotMatch(registry, /Knowledge Mint:/);
  } finally {
    process.exitCode = originalExitCode ?? 0;
  }
});
