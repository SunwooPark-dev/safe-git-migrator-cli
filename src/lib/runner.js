const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const { fileURLToPath } = require("node:url");

function isWindows() {
  return process.platform === "win32";
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "source";
}

function timestamp() {
  const date = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function createRunId(sourceName) {
  return `${timestamp()}-${slugify(sourceName)}`;
}

function defaultWorkspace() {
  return path.join(os.homedir(), ".safe-git-migrator");
}

function parseArgs(argv) {
  const result = {
    positionals: [],
    flags: {},
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      result.positionals.push(token);
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      result.flags[rawKey] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      result.flags[rawKey] = true;
      continue;
    }

    result.flags[rawKey] = next;
    index += 1;
  }

  return result;
}

function normalizeTargets(rawTargets) {
  const defaults = ["omx", "codex", "hermes", "antigravity"];
  if (!rawTargets) {
    return defaults;
  }

  const parsed = String(rawTargets)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return [...new Set(parsed)];
}

function getWikiTemplatePages(template) {
  const templates = {
    cli: {
      "Home.md": `# Project Wiki

Welcome to the canonical wiki for this CLI project.

## Start here
- [Install and Run](Install-and-Run.md)
- [Command Reference](Command-Reference.md)
- [Architecture](Architecture.md)
- [Testing and Verification](Testing-and-Verification.md)
- [Troubleshooting](Troubleshooting.md)
`,
      "Install-and-Run.md": `# Install and Run

## Goal
Explain how to install and run the CLI safely.
`,
      "Command-Reference.md": `# Command Reference

Document the supported commands, key flags, and expected outputs here.
`,
      "Architecture.md": `# Architecture

Summarize the important code paths, data flow, and design choices here.
`,
      "Testing-and-Verification.md": `# Testing and Verification

List the test commands, verification steps, and known gaps here.
`,
      "Troubleshooting.md": `# Troubleshooting

Document common failure modes and recovery steps here.
`,
    },
    adapter: {
      "Home.md": `# Adapter Repository Wiki

This wiki explains how to use and maintain the imported adapter repository.

## Start here
- [Quick Start](Quick-Start.md)
- [Adapters](Adapters.md)
- [Validation System](Validation-System.md)
- [Prompt Library](Prompt-Library.md)
- [FAQ](FAQ.md)
`,
      "Quick-Start.md": `# Quick Start

Explain the fastest usable path for the target tools here.
`,
      "Adapters.md": `# Adapters

Describe the role of each adapter file and target environment here.
`,
      "Validation-System.md": `# Validation System

Explain validation docs, result docs, and fixture/update rules here.
`,
      "Prompt-Library.md": `# Prompt Library

Collect the copy-paste prompts and scenario entry points here.
`,
      "FAQ.md": `# FAQ

Answer the most common questions about what this repository is and how to use it.
`,
    },
    generic: {
      "Home.md": `# Project Wiki

This is the canonical wiki home page.
`,
      "Quick-Start.md": `# Quick Start

Document the fastest way to use this project here.
`,
      "Architecture.md": `# Architecture

Document the important structure and design decisions here.
`,
    },
  };

  if (!templates[template]) {
    throw new Error(`Unsupported wiki template: ${template}`);
  }

  return templates[template];
}

function writeFileIfAbsent(filePath, contents) {
  if (fs.existsSync(filePath)) {
    return false;
  }
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, contents, "utf8");
  return true;
}

function ensureReadmeWikiPointer(rootDir) {
  const readmePath = path.join(rootDir, "README.md");
  const wikiLine = "## Wiki\nSee docs/wiki/Home.md for the canonical project wiki.\n";

  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(readmePath, `# Project\n\n${wikiLine}`, "utf8");
    return true;
  }

  const current = fs.readFileSync(readmePath, "utf8");
  if (current.includes("docs/wiki/Home.md")) {
    return false;
  }

  const separator = current.endsWith("\n") ? "\n" : "\n\n";
  fs.writeFileSync(readmePath, `${current}${separator}${wikiLine}`, "utf8");
  return true;
}

function executeWikiBootstrap(targetRoot, flags) {
  const resolvedRoot = path.resolve(targetRoot);
  ensureDir(resolvedRoot);
  const template = String(flags.template || "generic").toLowerCase();
  const pages = getWikiTemplatePages(template);
  const wikiDir = path.join(resolvedRoot, "docs", "wiki");
  ensureDir(wikiDir);

  const createdFiles = [];
  const skippedFiles = [];

  for (const [pageName, contents] of Object.entries(pages)) {
    const pagePath = path.join(wikiDir, pageName);
    const created = writeFileIfAbsent(pagePath, contents);
    if (created) {
      createdFiles.push(path.relative(resolvedRoot, pagePath));
    } else {
      skippedFiles.push(path.relative(resolvedRoot, pagePath));
    }
  }

  const readmeUpdated = ensureReadmeWikiPointer(resolvedRoot);

  return {
    command: "wiki-bootstrap",
    targetRoot: resolvedRoot,
    template,
    createdFiles,
    skippedFiles,
    readmeUpdated,
  };
}

function ensureWikiHomePage(rootDir) {
  const homePath = path.join(rootDir, "docs", "wiki", "Home.md");
  const pages = getWikiTemplatePages("generic");
  writeFileIfAbsent(homePath, pages["Home.md"]);
  return homePath;
}

function ensureHomeLink(rootDir, pageName, label) {
  const homePath = ensureWikiHomePage(rootDir);
  const marker = `[${label}](${pageName})`;
  const current = fs.readFileSync(homePath, "utf8");
  if (current.includes(marker)) {
    return false;
  }

  let updated = current;
  if (current.includes("## Start here")) {
    updated = current.replace("## Start here", `## Start here\n- ${marker}`);
  } else {
    const separator = current.endsWith("\n") ? "\n" : "\n\n";
    updated = `${current}${separator}## Start here\n- ${marker}\n`;
  }
  fs.writeFileSync(homePath, updated, "utf8");
  return true;
}

function executeWikiRegister(targetRoot, flags) {
  const resolvedRoot = path.resolve(targetRoot);
  ensureDir(resolvedRoot);
  const wikiDir = path.join(resolvedRoot, "docs", "wiki");
  const createdFiles = [];
  const requestedTemplate = String(flags.template || "generic").toLowerCase();
  const wikiExistsAlready = fs.existsSync(wikiDir) && fs.readdirSync(wikiDir, { withFileTypes: true }).length > 0;
  ensureDir(wikiDir);

  if (!wikiExistsAlready) {
    const starterPages = getWikiTemplatePages(requestedTemplate);
    for (const [pageName, contents] of Object.entries(starterPages)) {
      const pagePath = path.join(wikiDir, pageName);
      if (writeFileIfAbsent(pagePath, contents)) {
        createdFiles.push(path.relative(resolvedRoot, pagePath));
      }
    }
  }

  const registryPath = path.join(wikiDir, "Build-Registry.md");
  if (writeFileIfAbsent(
    registryPath,
    `# Build Registry

이 페이지는 프로젝트에서 실제로 만들어진 것과 그 검증 내용을 기록하는 canonical registry입니다.
`
  )) {
    createdFiles.push(path.relative(resolvedRoot, registryPath));
  }

  const title = String(flags.title || "Unnamed change").trim();
  const summary = String(flags.summary || "No summary provided.").trim();
  const files = String(flags.files || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const verification = String(flags.verification || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  const generatedAt = new Date().toISOString();

  const lines = [];
  lines.push(`\n## ${title}`);
  lines.push(`- Recorded at: ${generatedAt}`);
  lines.push(`- Summary: ${summary}`);
  if (files.length > 0) {
    lines.push(`- Files:`);
    for (const file of files) {
      lines.push(`  - ${file}`);
    }
  }
  if (verification.length > 0) {
    lines.push(`- Verification:`);
    for (const item of verification) {
      lines.push(`  - ${item}`);
    }
  }
  fs.appendFileSync(registryPath, `${lines.join("\n")}\n`, "utf8");

  const readmeUpdated = ensureReadmeWikiPointer(resolvedRoot);
  const homeUpdated = ensureHomeLink(resolvedRoot, "Build-Registry.md", "Build Registry");

  return {
    command: "wiki-register",
    targetRoot: resolvedRoot,
    entryTitle: title,
    registryPath,
    createdFiles,
    readmeUpdated,
    homeUpdated,
    files,
    verification,
  };
}

function getExpectedHandoffFiles(consumers) {
  const mapping = {
    codex: "HANDOFF_TO_CODEX_APP.md",
    antigravity: "HANDOFF_TO_ANTIGRAVITY_APP.md",
    gemini: "HANDOFF_TO_GEMINI_TERMINAL.md",
  };

  const normalized = [...new Set(consumers)];
  const unknownConsumers = normalized.filter((consumer) => !mapping[consumer]);
  const handoffFiles = normalized
    .map((consumer) => mapping[consumer])
    .filter(Boolean);

  return {
    handoffFiles,
    unknownConsumers,
  };
}

function executeWikiAudit(targetRoot, flags) {
  const resolvedRoot = path.resolve(targetRoot);
  const targetExists = fs.existsSync(resolvedRoot);
  const template = String(flags.template || "generic").toLowerCase();
  const pages = getWikiTemplatePages(template);
  const wikiDir = path.join(resolvedRoot, "docs", "wiki");
  const requiredFiles = Object.keys(pages).map((pageName) => path.join("docs", "wiki", pageName));
  const missingFiles = targetExists
    ? requiredFiles.filter((relativePath) => !fs.existsSync(path.join(resolvedRoot, relativePath)))
    : requiredFiles;

  const readmePath = path.join(resolvedRoot, "README.md");
  const readmePointerPresent =
    targetExists &&
    fs.existsSync(readmePath) &&
    fs.readFileSync(readmePath, "utf8").includes("docs/wiki/Home.md");

  const buildRegistryPath = path.join(wikiDir, "Build-Registry.md");
  const buildRegistryPresent = targetExists && fs.existsSync(buildRegistryPath);

  const consumers = String(flags.consumers || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const { handoffFiles, unknownConsumers } = getExpectedHandoffFiles(consumers);
  const requiredHandoffs = handoffFiles.map((pageName) => path.join("docs", "wiki", pageName));
  const missingHandoffs = targetExists
    ? requiredHandoffs.filter((relativePath) => !fs.existsSync(path.join(resolvedRoot, relativePath)))
    : requiredHandoffs;

  let status = "pass";
  if (!targetExists || unknownConsumers.length > 0 || missingFiles.length > 0 || !readmePointerPresent || missingHandoffs.length > 0) {
    status = "fail";
  } else if (!buildRegistryPresent) {
    status = "warn";
  }

  const recommendations = [];
  if (!targetExists) {
    recommendations.push("Create or point to an existing target root before running wiki-audit. The audit command is read-only and will not create missing directories.");
  }
  if (missingFiles.length > 0) {
    recommendations.push("Run wiki-bootstrap with the correct template to create the missing canonical wiki pages.");
  }
  if (!readmePointerPresent) {
    recommendations.push("Add the README wiki pointer so users can discover docs/wiki/Home.md.");
  }
  if (!buildRegistryPresent) {
    recommendations.push("Run wiki-register after a meaningful implementation slice to create Build-Registry.md.");
  }
  if (missingHandoffs.length > 0) {
    recommendations.push("Add the required consumer handoff pages under docs/wiki/ before handoff.");
  }
  if (unknownConsumers.length > 0) {
    recommendations.push(`Fix unknown consumer values: ${unknownConsumers.join(", ")}.`);
  }

  return {
    command: "wiki-audit",
    targetRoot: resolvedRoot,
    targetExists,
    template,
    status,
    requiredFiles,
    missingFiles,
    readmePointerPresent,
    buildRegistryPresent,
    requiredHandoffs,
    missingHandoffs,
    unknownConsumers,
    recommendations,
  };
}

function normalizeSource(input) {
  if (!input) {
    throw new Error("A source path or URL is required.");
  }

  if (fs.existsSync(input)) {
    const resolved = path.resolve(input);
    return {
      kind: "local",
      input,
      sourceName: path.basename(resolved),
      cloneUrl: null,
      path: resolved,
      provider: "local",
    };
  }

  let url;
  try {
    url = new URL(input);
  } catch (error) {
    throw new Error(`Invalid source URL or path: ${input}`);
  }

  const host = url.hostname.toLowerCase();
  const pathParts = url.pathname.split("/").filter(Boolean);

  if (url.protocol === "file:") {
    const localPath = fileURLToPath(url);
    if (!fs.existsSync(localPath)) {
      throw new Error(`Local git URL does not exist: ${input}`);
    }
    return {
      kind: "git",
      provider: "file",
      input,
      sourceName: path.basename(localPath),
      cloneUrl: input,
      path: localPath,
    };
  }

  if (host.includes("github.com")) {
    const [owner, repo] = pathParts;
    if (!owner || !repo) {
      throw new Error("GitHub URLs must look like https://github.com/<owner>/<repo>.");
    }
    return {
      kind: "git",
      provider: "github",
      input,
      sourceName: repo.replace(/\.git$/i, ""),
      cloneUrl: `https://github.com/${owner}/${repo.replace(/\.git$/i, "")}.git`,
      path: null,
    };
  }

  if (host.includes("huggingface.co")) {
    if (pathParts.length < 2) {
      throw new Error("Hugging Face URLs must include at least an owner and repo.");
    }

    let owner;
    let repo;
    if (pathParts[0] === "datasets" || pathParts[0] === "spaces") {
      [, owner, repo] = pathParts;
    } else {
      [owner, repo] = pathParts;
    }

    if (!owner || !repo) {
      throw new Error("Unsupported Hugging Face URL format.");
    }

    return {
      kind: "git",
      provider: "huggingface",
      input,
      sourceName: repo.replace(/\.git$/i, ""),
      cloneUrl: input.endsWith(".git") ? input : `${input.replace(/\/+$/, "")}.git`,
      path: null,
    };
  }

  throw new Error(`Unsupported source host: ${host}`);
}

function copyDir(sourceDir, targetDir, ignoredPrefixes = []) {
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    force: true,
    filter: (src) => {
      const base = path.basename(src);
      if (base === ".git" || base === "node_modules") {
        return false;
      }
      return !ignoredPrefixes.some((prefix) => src.startsWith(prefix));
    },
  });
}

function runGit(args, cwd) {
  const result = cp.spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

function copySnapshotFromCache(cacheDir, sourceDir) {
  fs.rmSync(sourceDir, { recursive: true, force: true });
  copyDir(cacheDir, sourceDir);
}

function acquireSource(source, sourceDir, workspace) {
  ensureDir(path.dirname(sourceDir));

  if (source.kind === "local") {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    const ignored = [];
    if (workspace.startsWith(source.path)) {
      ignored.push(workspace);
    }
    if (sourceDir.startsWith(source.path)) {
      const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgm-stage-"));
      copyDir(source.path, stagingDir, ignored);
      copyDir(stagingDir, sourceDir);
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } else {
      copyDir(source.path, sourceDir, ignored);
    }
    return {
      mode: "local-copy",
      sourceDir,
      cacheDir: null,
    };
  }

  const cacheDir = path.join(workspace, "cache", "sources", `${source.provider}-${slugify(source.sourceName)}`);
  ensureDir(path.dirname(cacheDir));

  let mode = "git-clone";
  if (!fs.existsSync(cacheDir)) {
    runGit(["clone", "--depth", "1", source.cloneUrl, cacheDir], process.cwd());
  } else {
    mode = "git-fetch";
    runGit(["fetch", "--depth", "1", "origin"], cacheDir);
    runGit(["reset", "--hard", "FETCH_HEAD"], cacheDir);
    runGit(["clean", "-fd"], cacheDir);
  }

  copySnapshotFromCache(cacheDir, sourceDir);
  return {
    mode,
    sourceDir,
    cacheDir,
  };
}

function findLicenseText(rootDir) {
  const candidates = ["LICENSE", "LICENSE.txt", "LICENSE.md", "license", "license.txt", "license.md"];
  for (const candidate of candidates) {
    const fullPath = path.join(rootDir, candidate);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return {
        file: fullPath,
        text: fs.readFileSync(fullPath, "utf8"),
      };
    }
  }
  return null;
}

function enforceMitOnly(sourceDir) {
  const license = findLicenseText(sourceDir);
  if (!license) {
    return {
      ok: false,
      reason: "No LICENSE file found; v1 fails closed when license is unverifiable.",
      evidenceFile: null,
    };
  }

  const normalized = license.text.toLowerCase();
  const looksMit =
    normalized.includes("mit license") ||
    (normalized.includes("permission is hereby granted") &&
      normalized.includes("deal in the software without restriction"));

  return {
    ok: looksMit,
    reason: looksMit ? "MIT license detected." : "License file found but did not match MIT terms.",
    evidenceFile: path.relative(sourceDir, license.file),
  };
}

function walkFiles(rootDir) {
  const results = [];
  const visit = (currentDir) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  };
  visit(rootDir);
  return results;
}

function collectSkillBundles(rootDir) {
  const bundles = [];
  const visited = new Set();
  const visit = (currentDir) => {
    if (visited.has(currentDir)) {
      return;
    }
    visited.add(currentDir);
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    const hasSkill = entries.some((entry) => entry.isFile() && entry.name === "SKILL.md");
    if (hasSkill) {
      bundles.push(currentDir);
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules") {
        visit(path.join(currentDir, entry.name));
      }
    }
  };
  visit(rootDir);
  return bundles;
}

function classifyArtifacts(rootDir) {
  const skillBundles = collectSkillBundles(rootDir);
  const skillBundleSet = new Set(skillBundles);
  const files = walkFiles(rootDir);
  const records = [];
  const unsupportedExtensions = new Set([".exe", ".dll", ".so", ".dylib", ".bin"]);
  const partialExtensions = new Set([".sh", ".ps1", ".bat"]);

  for (const bundleDir of skillBundles) {
    records.push({
      type: "skill-bundle",
      status: "migratable",
      sourcePath: bundleDir,
      relativePath: path.relative(rootDir, bundleDir),
      reason: "Directory contains SKILL.md and can be migrated as a bundle.",
      manualAction: null,
    });
  }

  for (const fullPath of files) {
    if ([...skillBundleSet].some((bundleDir) => fullPath.startsWith(`${bundleDir}${path.sep}`))) {
      continue;
    }

    const relativePath = path.relative(rootDir, fullPath);
    const baseName = path.basename(fullPath);
    const extension = path.extname(fullPath).toLowerCase();
    let type = "generic";
    let status = "migratable";
    let reason = "Generic file can be copied into the target import tree.";
    let manualAction = null;

    if (baseName === "AGENTS.md") {
      type = "agents-markdown";
      reason = "AGENTS.md can be migrated as guidance content.";
    } else if (baseName.toLowerCase().includes("prompt") || extension === ".prompt") {
      type = "prompt";
      reason = "Prompt-like file detected.";
    } else if (relativePath.includes(".github\\workflows") || relativePath.includes(".github/workflows")) {
      type = "workflow";
      reason = "Workflow files are copied as reference artifacts.";
    } else if (unsupportedExtensions.has(extension)) {
      type = "binary";
      status = "unsupported";
      reason = "Binary artifacts are not automatically migrated in v1.";
      manualAction = "Review the binary manually and decide whether it should be redistributed.";
    } else if (partialExtensions.has(extension)) {
      type = "script";
      status = "partial";
      reason = "Script files are copied, but execution semantics may require manual review on Windows.";
      manualAction = "Review and adapt shell-specific commands if needed.";
    }

    records.push({
      type,
      status,
      sourcePath: fullPath,
      relativePath,
      reason,
      manualAction,
    });
  }

  return records;
}

function getInstallRoots(flags) {
  const home = os.homedir();
  return {
    codex: flags["install-root-codex"] || path.join(home, ".codex"),
    omx: flags["install-root-omx"] || path.join(home, ".omx"),
    hermes: flags["install-root-hermes"] || path.join(home, ".hermes"),
    antigravity: flags["install-root-antigravity"] || path.join(home, ".agent"),
  };
}

function mapArtifactToRelativeTarget(platform, sourceName, artifact) {
  if (artifact.type === "skill-bundle") {
    const skillName = path.basename(artifact.sourcePath);
    if (platform === "codex") {
      return path.join("skills", skillName);
    }
    if (platform === "antigravity") {
      return path.join("skills", skillName);
    }
    return path.join("imports", sourceName, "skills", skillName);
  }

  if (platform === "codex" && artifact.type === "agents-markdown") {
    return path.join("agents", sourceName, artifact.relativePath);
  }

  if (platform === "codex" && artifact.type === "prompt") {
    return path.join("prompts", sourceName, path.basename(artifact.relativePath));
  }

  if (platform === "antigravity" && artifact.type === "prompt") {
    return path.join("prompts", sourceName, path.basename(artifact.relativePath));
  }

  return path.join("imports", sourceName, artifact.relativePath);
}

function transformArtifacts({ sourceDir, artifacts, targets, outputRoot, sourceName }) {
  const summaries = [];

  for (const target of targets) {
    const targetRoot = path.join(outputRoot, target);
    ensureDir(targetRoot);
    let migrated = 0;
    let partial = 0;
    let unsupported = 0;
    const manifest = [];

    for (const artifact of artifacts) {
      if (artifact.status === "unsupported") {
        unsupported += 1;
        manifest.push({
          target,
          relativeTargetPath: null,
          sourcePath: artifact.sourcePath,
          status: artifact.status,
          reason: artifact.reason,
          manualAction: artifact.manualAction,
        });
        continue;
      }

      const relativeTargetPath = mapArtifactToRelativeTarget(target, sourceName, artifact);
      const fullTargetPath = path.join(targetRoot, relativeTargetPath);

      if (artifact.type === "skill-bundle") {
        copyDir(artifact.sourcePath, fullTargetPath);
      } else {
        ensureDir(path.dirname(fullTargetPath));
        fs.copyFileSync(artifact.sourcePath, fullTargetPath);
      }

      if (artifact.status === "partial") {
        partial += 1;
      } else {
        migrated += 1;
      }

      manifest.push({
        target,
        relativeTargetPath,
        sourcePath: artifact.sourcePath,
        status: artifact.status,
        reason: artifact.reason,
        manualAction: artifact.manualAction,
      });
    }

    summaries.push({
      target,
      root: targetRoot,
      migrated,
      partial,
      unsupported,
      manifest,
    });
  }

  return summaries;
}

function installTargetSummary(summary, installRoot, runDir) {
  const backupsDir = path.join(runDir, "backups", summary.target);
  ensureDir(backupsDir);
  const installEntries = [];

  for (const item of summary.manifest) {
    if (!item.relativeTargetPath) {
      installEntries.push({
        ...item,
        installedPath: null,
        backupPath: null,
        installed: false,
      });
      continue;
    }

    const fromPath = path.join(summary.root, item.relativeTargetPath);
    const installedPath = path.join(installRoot, item.relativeTargetPath);
    const existsAlready = fs.existsSync(installedPath);
    let backupPath = null;

    ensureDir(path.dirname(installedPath));
    if (existsAlready) {
      backupPath = path.join(backupsDir, item.relativeTargetPath);
      ensureDir(path.dirname(backupPath));
      const stat = fs.statSync(installedPath);
      if (stat.isDirectory()) {
        copyDir(installedPath, backupPath);
      } else {
        fs.copyFileSync(installedPath, backupPath);
      }
      fs.rmSync(installedPath, { recursive: true, force: true });
    }

    const sourceStat = fs.statSync(fromPath);
    if (sourceStat.isDirectory()) {
      copyDir(fromPath, installedPath);
    } else {
      fs.copyFileSync(fromPath, installedPath);
    }

    installEntries.push({
      ...item,
      installedPath,
      backupPath,
      installed: true,
    });
  }

  return installEntries;
}

function verifyManifestEntries(entries) {
  const failures = [];
  for (const entry of entries) {
    if (!entry.relativeTargetPath) {
      continue;
    }
    if (!entry.installedPath || !fs.existsSync(entry.installedPath)) {
      failures.push({
        ...entry,
        failure: "Installed path is missing.",
      });
    }
  }
  return failures;
}

function attemptFallback(target, installRoot, sourceName, summary) {
  const fallbackRoot = path.join(installRoot, "imports", sourceName, "fallback", target);
  copyDir(summary.root, fallbackRoot);
  return fallbackRoot;
}

function rollbackRun(runDir) {
  const installManifestPath = path.join(runDir, "install-manifest.json");
  if (!fs.existsSync(installManifestPath)) {
    throw new Error(`No install manifest found for run at ${runDir}`);
  }

  const manifest = readJson(installManifestPath);

  for (const target of manifest.targets.slice().reverse()) {
    for (const entry of target.entries.slice().reverse()) {
      if (!entry.relativeTargetPath || !entry.installedPath) {
        continue;
      }

      fs.rmSync(entry.installedPath, { recursive: true, force: true });

      if (entry.backupPath && fs.existsSync(entry.backupPath)) {
        ensureDir(path.dirname(entry.installedPath));
        const stat = fs.statSync(entry.backupPath);
        if (stat.isDirectory()) {
          copyDir(entry.backupPath, entry.installedPath);
        } else {
          fs.copyFileSync(entry.backupPath, entry.installedPath);
        }
      }
    }
  }

  const rollbackReport = {
    runId: manifest.runId,
    rolledBackAt: new Date().toISOString(),
    targets: manifest.targets.map((target) => ({
      target: target.target,
      restoredItems: target.entries.filter((entry) => entry.relativeTargetPath).length,
    })),
  };
  writeJson(path.join(runDir, "rollback-report.json"), rollbackReport);
  return rollbackReport;
}

function buildReport({ runId, source, licenseCheck, artifacts, summaries, applyResult, noInstall }) {
  const byStatus = artifacts.reduce(
    (acc, record) => {
      acc[record.status] = (acc[record.status] || 0) + 1;
      return acc;
    },
    { migratable: 0, partial: 0, unsupported: 0 }
  );

  return {
    runId,
    source,
    license: licenseCheck,
    inventory: {
      totalArtifacts: artifacts.length,
      byStatus,
    },
    targets: summaries.map((summary) => ({
      target: summary.target,
      migrated: summary.migrated,
      partial: summary.partial,
      unsupported: summary.unsupported,
    })),
    install: noInstall ? { mode: "skipped" } : applyResult,
  };
}

function formatHumanReport(report) {
  if (report.command === "wiki-bootstrap") {
    return [
      `Command: ${report.command}`,
      `Target root: ${report.targetRoot}`,
      `Template: ${report.template}`,
      `Created files: ${report.createdFiles.length}`,
      `Skipped files: ${report.skippedFiles.length}`,
      `README updated: ${report.readmeUpdated ? "yes" : "no"}`,
    ].join("\n");
  }

  if (report.command === "wiki-register") {
    return [
      `Command: ${report.command}`,
      `Target root: ${report.targetRoot}`,
      `Entry title: ${report.entryTitle}`,
      `Registry path: ${report.registryPath}`,
      `Created files: ${report.createdFiles.length}`,
      `README updated: ${report.readmeUpdated ? "yes" : "no"}`,
      `Home updated: ${report.homeUpdated ? "yes" : "no"}`,
    ].join("\n");
  }

  if (report.command === "wiki-audit") {
    return [
      `Command: ${report.command}`,
      `Target root: ${report.targetRoot}`,
      `Template: ${report.template}`,
      `Status: ${report.status}`,
      `Missing files: ${report.missingFiles.length}`,
      `README pointer present: ${report.readmePointerPresent ? "yes" : "no"}`,
      `Build registry present: ${report.buildRegistryPresent ? "yes" : "no"}`,
      `Missing handoffs: ${report.missingHandoffs.length}`,
    ].join("\n");
  }

  const lines = [];
  lines.push(`Run ID: ${report.runId}`);
  lines.push(`Source: ${report.source.input}`);
  lines.push(`License: ${report.license.ok ? "PASS" : "FAIL"} — ${report.license.reason}`);
  lines.push(
    `Inventory: total=${report.inventory.totalArtifacts}, migratable=${report.inventory.byStatus.migratable}, partial=${report.inventory.byStatus.partial}, unsupported=${report.inventory.byStatus.unsupported}`
  );
  for (const target of report.targets) {
    lines.push(
      `Target ${target.target}: migrated=${target.migrated}, partial=${target.partial}, unsupported=${target.unsupported}`
    );
  }
  if (report.install?.mode === "skipped") {
    lines.push("Install: skipped (--no-install or dry-run)");
  } else if (report.install) {
    lines.push(`Install verification: ${report.install.ok ? "PASS" : "FAIL"}`);
    if (report.install.failures?.length) {
      for (const failure of report.install.failures) {
        lines.push(`- ${failure.target}: ${failure.failure}`);
      }
    }
    if (report.install.fallbacks?.length) {
      for (const fallback of report.install.fallbacks) {
        lines.push(`- fallback used for ${fallback.target}: ${fallback.path}`);
      }
    }
  }
  return lines.join("\n");
}

async function executeMigration(command, sourceInput, flags) {
  if (!isWindows()) {
    throw new Error("v1 is Windows only.");
  }

  if (command === "wiki-bootstrap") {
    return executeWikiBootstrap(sourceInput, flags);
  }
  if (command === "wiki-register") {
    return executeWikiRegister(sourceInput, flags);
  }
  if (command === "wiki-audit") {
    return executeWikiAudit(sourceInput, flags);
  }

  const workspace = path.resolve(flags.workspace || defaultWorkspace());
  const source = command === "verify" || command === "rollback" ? null : normalizeSource(sourceInput);
  const runId = command === "verify" || command === "rollback" ? sourceInput : createRunId(source.sourceName);
  const runDir = path.join(workspace, "runs", runId);
  const metadataDir = path.join(runDir, "reports");

  if (command === "verify") {
    const installManifest = readJson(path.join(runDir, "install-manifest.json"));
    const failures = installManifest.targets.flatMap((target) =>
      verifyManifestEntries(
        target.entries.map((entry) => ({
          ...entry,
          target: target.target,
        }))
      )
    );
    const verifyReport = {
      runId,
      ok: failures.length === 0,
      failures,
      verifiedAt: new Date().toISOString(),
    };
    writeJson(path.join(runDir, "verify-report.json"), verifyReport);
    return verifyReport;
  }

  if (command === "rollback") {
    return rollbackRun(runDir);
  }

  ensureDir(metadataDir);

  const sourceDir = path.join(runDir, "source");
  const outputDir = path.join(runDir, "outputs");
  const targets = normalizeTargets(flags.targets);
  const noInstall = command === "dry-run" || command === "inspect" || flags["no-install"] === true;
  const shouldTransform = command !== "inspect";

  const acquisition = acquireSource(source, sourceDir, workspace);
  writeJson(path.join(runDir, "source-manifest.json"), {
    runId,
    command,
    source,
    acquisition,
    snapshottedAt: new Date().toISOString(),
  });
  const licenseCheck = enforceMitOnly(sourceDir);
  if (!licenseCheck.ok) {
    const report = {
      runId,
      source,
      acquisition,
      license: licenseCheck,
      failedAt: new Date().toISOString(),
      failure: "license-gate",
    };
    writeJson(path.join(metadataDir, "failed-report.json"), report);
    return report;
  }

  const artifacts = classifyArtifacts(sourceDir);
  const summaries = shouldTransform
    ? transformArtifacts({
        sourceDir,
        artifacts,
        targets,
        outputRoot: outputDir,
        sourceName: source.sourceName,
      })
    : [];

  const installRoots = getInstallRoots(flags);
  let applyResult = null;

  if (!noInstall) {
    const installManifest = {
      runId,
      sourceName: source.sourceName,
      installedAt: new Date().toISOString(),
      targets: [],
    };
    const failures = [];
    const fallbacks = [];

    for (const summary of summaries) {
      const installRoot = installRoots[summary.target];
      ensureDir(installRoot);
      const entries = installTargetSummary(summary, installRoot, runDir);
      const targetFailures = verifyManifestEntries(
        entries.map((entry) => ({
          ...entry,
          target: summary.target,
        }))
      );

      if (targetFailures.length > 0) {
        const fallbackPath = attemptFallback(summary.target, installRoot, source.sourceName, summary);
        fallbacks.push({
          target: summary.target,
          path: fallbackPath,
        });
      }

      installManifest.targets.push({
        target: summary.target,
        installRoot,
        entries,
      });
      failures.push(...targetFailures);
    }

    writeJson(path.join(runDir, "install-manifest.json"), installManifest);
    applyResult = {
      ok: failures.length === 0,
      failures,
      fallbacks,
    };
  }

  const report = buildReport({
    runId,
    source,
    licenseCheck,
    artifacts,
    summaries,
    applyResult,
    noInstall,
  });

  writeJson(path.join(metadataDir, `${command}-report.json`), report);
  return report;
}

function printHelp() {
  console.log(`safe-git-migrator

Usage:
  safe-git-migrator inspect <source> [--workspace <path>] [--targets <list>]
  safe-git-migrator dry-run <source> [--workspace <path>] [--targets <list>]
  safe-git-migrator apply <source> [--workspace <path>] [--targets <list>] [--no-install]
  safe-git-migrator verify <run-id> [--workspace <path>]
  safe-git-migrator rollback <run-id> [--workspace <path>]
  safe-git-migrator wiki-bootstrap <target-root> [--template cli|adapter|generic]
  safe-git-migrator wiki-register <target-root> --title <title> --summary <summary> [--files a,b] [--verification "cmd1; cmd2"]
  safe-git-migrator wiki-audit <target-root> [--template cli|adapter|generic] [--consumers codex,antigravity,gemini]

Optional install-root overrides:
  --install-root-codex <path>
  --install-root-omx <path>
  --install-root-hermes <path>
  --install-root-antigravity <path>
`);
}

async function runCli(argv) {
  const parsed = parseArgs(argv);
  const [command, source] = parsed.positionals;

  if (!command || command === "--help" || command === "help") {
    printHelp();
    return;
  }

  if (!["inspect", "dry-run", "apply", "verify", "rollback", "wiki-bootstrap", "wiki-register", "wiki-audit"].includes(command)) {
    throw new Error(`Unsupported command: ${command}`);
  }

  if (!source) {
    throw new Error(`Command "${command}" requires a source URL/path or run-id.`);
  }

  const report = await executeMigration(command, source, parsed.flags);

  if (parsed.flags["report-json"]) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatHumanReport(report));
}

module.exports = {
  runCli,
  parseArgs,
  normalizeSource,
  enforceMitOnly,
  classifyArtifacts,
  executeMigration,
  mapArtifactToRelativeTarget,
  defaultWorkspace,
};
