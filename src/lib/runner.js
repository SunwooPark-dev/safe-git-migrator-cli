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

function parseWikiBuildRegistry(markdown) {
  const content = String(markdown || "");
  const headingPattern = /^##\s+(.+)\r?$/gm;
  const headings = [...content.matchAll(headingPattern)];
  const entries = [];

  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index];
    const title = String(match[1] || "").trim();
    const start = match.index + match[0].length;
    const end = headings[index + 1]?.index ?? content.length;
    const body = content.slice(start, end);
    const lines = body.split(/\r?\n/);

    const recordedAtLine = lines.find((line) => line.trimStart().startsWith("- Recorded at:"));
    const summaryLine = lines.find((line) => line.trimStart().startsWith("- Summary:"));
    const files = [];
    const verification = [];

    let activeList = null;
    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === "- Files:") {
        activeList = files;
        continue;
      }
      if (trimmed === "- Verification:") {
        activeList = verification;
        continue;
      }

      const listMatch = line.match(/^\s{2,}-\s+(.+)$/);
      if (listMatch && activeList) {
        activeList.push(listMatch[1].trim());
        continue;
      }

      if (trimmed.startsWith("- ") && !trimmed.startsWith("- Files:") && !trimmed.startsWith("- Verification:")) {
        activeList = null;
      }
    }

    entries.push({
      title,
      recordedAt: recordedAtLine ? recordedAtLine.replace(/^\s*-\s*Recorded at:\s*/, "").trim() : "",
      summary: summaryLine ? summaryLine.replace(/^\s*-\s*Summary:\s*/, "").trim() : "",
      files,
      verification,
    });
  }

  return entries;
}

function scanWikiMintEntries(entries) {
  const detectors = [
    { id: "password", pattern: /password/i },
    { id: "secret", pattern: /secret/i },
    { id: "key=", pattern: /key\s*=/i },
    { id: "token=", pattern: /token\s*=/i },
    { id: ".env", pattern: /\.env\b/i },
    { id: "absolute-path", pattern: /\b[A-Za-z]:\\|\/home\/|\/Users\//i },
    { id: "jwt", pattern: /\beyJ[A-Za-z0-9._-]*\b/ },
  ];

  const issues = [];

  for (const entry of entries) {
    const haystack = [
      entry.title,
      entry.recordedAt,
      entry.summary,
      ...entry.files,
      ...entry.verification,
    ]
      .filter(Boolean)
      .join("\n");

    const matches = detectors
      .filter((detector) => detector.pattern.test(haystack))
      .map((detector) => detector.id);

    if (matches.length > 0) {
      issues.push({
        title: entry.title,
        recordedAt: entry.recordedAt,
        matches,
      });
    }
  }

  return {
    blocked: issues.length > 0,
    issues,
  };
}

function getWikiMintOutputFileName(format) {
  const mapping = {
    "readme-showcase": "BUILD_SHOWCASE.md",
    "x-thread": "BUILD_THREAD.md",
    substack: "BUILD_SUBSTACK.html",
  };

  if (mapping[format]) {
    return mapping[format];
  }

  throw new Error(`Unsupported wiki-mint format: ${format}`);
}

function resolveWikiMintOutputPath(targetRoot, flags, format) {
  const outputFileName = getWikiMintOutputFileName(format);
  const rawOutputDir = flags["output-dir"];
  const outputDir = rawOutputDir
    ? path.isAbsolute(String(rawOutputDir))
      ? path.resolve(String(rawOutputDir))
      : path.resolve(targetRoot, String(rawOutputDir))
    : path.join(targetRoot, "docs", "wiki");

  return {
    outputDir,
    outputFileName,
    outputPath: path.join(outputDir, outputFileName),
  };
}

function isMintGeneratedRegistryEntry(entry) {
  const title = String(entry?.title || "").trim();
  const verification = Array.isArray(entry?.verification) ? entry.verification : [];
  return (
    /^Knowledge Mint:\s+.+\s+generated$/i.test(title) &&
    verification.some((item) => /^wiki-mint\s+--format\s+\S+$/i.test(String(item || "").trim()))
  );
}

function parseDateOnly(value, flagName) {
  if (!value) {
    return null;
  }

  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Invalid ${flagName} date: ${raw}. Expected YYYY-MM-DD.`);
  }

  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    throw new Error(`Invalid ${flagName} date: ${raw}. Expected YYYY-MM-DD.`);
  }

  return raw;
}

function parseWikiMintDateRange(flags) {
  const from = parseDateOnly(flags.from, "--from");
  const to = parseDateOnly(flags.to, "--to");

  if (from && to && from > to) {
    throw new Error(`Invalid date range: --from ${from} is after --to ${to}.`);
  }

  return {
    from,
    to,
    active: Boolean(from || to),
  };
}

function getEntryDateOnly(entry) {
  const recordedAt = String(entry?.recordedAt || "").trim();
  if (!recordedAt) {
    return null;
  }
  const match = recordedAt.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) {
    return null;
  }
  try {
    return parseDateOnly(match[1], "recordedAt");
  } catch {
    return null;
  }
}

function getWikiMintRenderableEntries(entries, dateRange = { active: false }) {
  return entries
    .filter((entry) => !isMintGeneratedRegistryEntry(entry))
    .filter((entry) => {
      if (!dateRange.active) {
        return true;
      }
      const entryDate = getEntryDateOnly(entry);
      if (!entryDate) {
        return false;
      }
      if (dateRange.from && entryDate < dateRange.from) {
        return false;
      }
      if (dateRange.to && entryDate > dateRange.to) {
        return false;
      }
      return true;
    });
}

function renderReadmeShowcase(targetRoot, entries) {
  const projectName = path.basename(targetRoot);
  const totalFiles = entries.reduce((sum, entry) => sum + entry.files.length, 0);
  const totalVerificationSteps = entries.reduce((sum, entry) => sum + entry.verification.length, 0);
  const lines = [
    `# ${projectName} Build Showcase`,
    "",
    "> Source: docs/wiki/Build-Registry.md",
    "> Generated by: safe-git-migrator wiki-mint --format readme-showcase",
    `> Generated at: ${new Date().toISOString()}`,
    "",
    "## Statistics",
    "",
    `- Entries: ${entries.length}`,
    `- File references: ${totalFiles}`,
    `- Verification steps: ${totalVerificationSteps}`,
    "",
  ];

  for (const entry of entries) {
    lines.push(`## ${entry.title}`);
    lines.push("");
    lines.push(`- Recorded at: ${entry.recordedAt || "Unknown"}`);
    lines.push(`- Summary: ${entry.summary || "No summary provided."}`);
    if (entry.files.length > 0) {
      lines.push("- Files:");
      for (const file of entry.files) {
        lines.push(`  - ${file}`);
      }
    }
    if (entry.verification.length > 0) {
      lines.push("- Verification:");
      for (const item of entry.verification) {
        lines.push(`  - ${item}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function renderXThread(targetRoot, entries) {
  const projectName = path.basename(targetRoot);
  const warnings = [];
  const blocks = entries.map((entry, index) => {
    const files = entry.files.length > 0 ? `\nFiles: ${entry.files.join(", ")}` : "";
    const block = `${index + 1}/${entries.length} ${entry.title}\n${entry.summary || "No summary provided."}${files}`;
    if (block.length > 280) {
      warnings.push(`x-thread block ${index + 1}/${entries.length} exceeds 280 chars (${block.length}).`);
    }
    return block;
  });

  const header = [
    `${projectName} build thread`,
    `Source: docs/wiki/Build-Registry.md`,
    `Generated by: safe-git-migrator wiki-mint --format x-thread`,
    `Generated at: ${new Date().toISOString()}`,
  ].join("\n");

  return {
    content: `${header}\n\n---\n\n${blocks.join("\n\n---\n\n")}\n`,
    warnings,
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSubstackHtml(targetRoot, entries) {
  const projectName = path.basename(targetRoot);
  const sections = entries
    .map((entry) => {
      const fileItems = entry.files.map((file) => `<li>${escapeHtml(file)}</li>`).join("");
      const verificationItems = entry.verification.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      return [
        "<section>",
        `<h2>${escapeHtml(entry.title)}</h2>`,
        `<p><strong>Recorded:</strong> ${escapeHtml((entry.recordedAt || "").slice(0, 10) || "Unknown")}</p>`,
        `<blockquote>${escapeHtml(entry.summary || "No summary provided.")}</blockquote>`,
        fileItems ? `<h3>Files</h3><ul>${fileItems}</ul>` : "",
        verificationItems ? `<h3>Verification</h3><ul>${verificationItems}</ul>` : "",
        "</section>",
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(projectName)} Build Showcase</title>
</head>
<body>
  <h1>${escapeHtml(projectName)} Build Showcase</h1>
  <p><em>Auto-generated from docs/wiki/Build-Registry.md by safe-git-migrator wiki-mint --format substack.</em></p>
  <p><strong>Generated at:</strong> ${escapeHtml(new Date().toISOString())}</p>
  ${sections}
</body>
</html>
`;
}

function renderWikiMintOutput(format, targetRoot, entries) {
  if (format === "readme-showcase") {
    return {
      content: renderReadmeShowcase(targetRoot, entries),
      warnings: [],
    };
  }
  if (format === "x-thread") {
    return renderXThread(targetRoot, entries);
  }
  if (format === "substack") {
    return {
      content: renderSubstackHtml(targetRoot, entries),
      warnings: [],
    };
  }
  throw new Error(`Unsupported wiki-mint format: ${format}`);
}

function executeWikiMint(targetRoot, flags) {
  const resolvedRoot = path.resolve(targetRoot);
  if (!fs.existsSync(resolvedRoot)) {
    throw new Error(`Target root does not exist: ${resolvedRoot}`);
  }

  const format = String(flags.format || "readme-showcase").toLowerCase();
  const mode = flags["scan-only"] ? "scan-only" : flags["dry-run"] ? "dry-run" : "generate";
  const registryPath = path.join(resolvedRoot, "docs", "wiki", "Build-Registry.md");
  if (!fs.existsSync(registryPath)) {
    throw new Error(`Build-Registry.md does not exist: ${registryPath}`);
  }

  const registryContents = fs.readFileSync(registryPath, "utf8");
  const entries = parseWikiBuildRegistry(registryContents);
  const dateRange = parseWikiMintDateRange(flags);
  const renderableEntries = getWikiMintRenderableEntries(entries, dateRange);
  const scan = scanWikiMintEntries(entries);
  const { outputPath, outputFileName } = resolveWikiMintOutputPath(resolvedRoot, flags, format);
  const report = {
    command: "wiki-mint",
    targetRoot: resolvedRoot,
    format,
    mode,
    status: "ok",
    registryPath,
    entryCount: entries.length,
    renderedEntryCount: renderableEntries.length,
    dateRange: {
      from: dateRange.from,
      to: dateRange.to,
    },
    outputPath,
    outputFileName,
    created: false,
    registryAppended: false,
    scan,
    warnings: [],
  };

  if (entries.length === 0) {
    report.status = "warn";
    report.warnings.push("No Build-Registry entries were found; skipped generation.");
    return report;
  }

  if (scan.blocked) {
    report.status = "blocked";
    report.exitCode = 1;
    report.warnings.push("Sensitive content detected; generation was blocked.");
    return report;
  }

  if (renderableEntries.length === 0) {
    report.status = "warn";
    report.warnings.push("No renderable Build-Registry entries matched the current filters; skipped generation.");
    return report;
  }

  if (mode !== "generate") {
    return report;
  }

  const rendered = renderWikiMintOutput(format, resolvedRoot, renderableEntries);
  report.warnings.push(...rendered.warnings);
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, rendered.content, "utf8");
  report.created = true;
  report.generatedFile = outputPath;

  const registryFilePath = path.relative(resolvedRoot, outputPath) || outputPath;
  executeWikiRegister(resolvedRoot, {
    title: `Knowledge Mint: ${format} generated`,
    summary: `Generated ${outputFileName} from ${renderableEntries.length} Build-Registry entries.`,
    files: registryFilePath,
    verification: `wiki-mint --format ${format}`,
  });
  report.registryAppended = true;

  return report;
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

function getHandoffDescriptor(consumer) {
  const mapping = {
    codex: {
      fileName: "HANDOFF_TO_CODEX_APP.md",
      label: "Handoff to Codex App",
      audienceName: "Codex App",
    },
    antigravity: {
      fileName: "HANDOFF_TO_ANTIGRAVITY_APP.md",
      label: "Handoff to Antigravity App",
      audienceName: "Antigravity App",
    },
    gemini: {
      fileName: "HANDOFF_TO_GEMINI_TERMINAL.md",
      label: "Handoff to Gemini Terminal",
      audienceName: "Gemini terminal workflow",
    },
  };

  return mapping[consumer] || null;
}

function detectGitMetadata(rootDir) {
  if (!fs.existsSync(path.join(rootDir, ".git"))) {
    return {
      repoUrl: null,
      branch: null,
    };
  }

  const readGit = (args) => {
    const result = cp.spawnSync("git", args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: "pipe",
    });
    if (result.status !== 0) {
      return null;
    }
    return (result.stdout || "").trim() || null;
  };

  return {
    repoUrl: readGit(["config", "--get", "remote.origin.url"]),
    branch: readGit(["branch", "--show-current"]),
  };
}

function getDefaultReadOrder(template, consumer, rootDir) {
  const candidatesByTemplate = {
    cli: [
      path.join("docs", "wiki", "Home.md"),
      path.join("docs", "wiki", "Install-and-Run.md"),
      path.join("docs", "wiki", "Command-Reference.md"),
      "README.md",
    ],
    adapter: [
      path.join("docs", "wiki", "Home.md"),
      path.join("docs", "wiki", "Quick-Start.md"),
      consumer === "codex" ? path.join("adapters", "codex", "AGENTS.md") : null,
      consumer === "antigravity" ? path.join("adapters", "antigravity", "ANTIGRAVITY_PROMPT.md") : null,
      consumer === "gemini" ? path.join("adapters", "gemini", "GEMINI_PROMPT.md") : null,
      path.join("docs", "migration", "FINAL_PROMPTS.md"),
      path.join("docs", "wiki", "Validation-System.md"),
    ],
    generic: [
      path.join("docs", "wiki", "Home.md"),
      "README.md",
    ],
  };

  return (candidatesByTemplate[template] || candidatesByTemplate.generic)
    .filter(Boolean)
    .filter((relativePath) => fs.existsSync(path.join(rootDir, relativePath)));
}

function getHandoffRules(consumer) {
  if (consumer === "codex") {
    return {
      purpose: "implementation-oriented adapter and validation asset repository",
      rules: [
        "Use minimal diffs and verification-first execution.",
        "Avoid unrelated broad refactors.",
        "Record meaningful outcomes in wiki or migration result docs.",
      ],
    };
  }

  if (consumer === "antigravity") {
    return {
      purpose: "conversation-start prompt and validation asset repository",
      rules: [
        "State assumptions explicitly before proposing direction.",
        "Prefer small, controlled changes.",
        "If the task is ambiguous, offer interpretation options first.",
      ],
    };
  }

  return {
    purpose: "terminal-first prompt and validation asset repository",
    rules: [
      "Keep instructions short and execution-oriented.",
      "Do not guess.",
      "Respect existing structure and state verification after changes.",
    ],
  };
}

function buildHandoffContent({ descriptor, consumer, template, targetRoot, repoUrl, branch, readOrder }) {
  const rules = getHandoffRules(consumer);
  const localPath = targetRoot;
  const remoteLine = repoUrl ? `\`${repoUrl}\`` : "`(set repo URL later if needed)`";
  const branchLine = branch ? `\`${branch}\`` : "`main`";
  const readOrderLines =
    readOrder.length > 0
      ? readOrder.map((relativePath, index) => `${index + 1}. \`${relativePath}\``).join("\n")
      : "1. `docs/wiki/Home.md`";
  const repoTypeLine =
    template === "adapter"
      ? "adapter and validation repository"
      : template === "cli"
        ? "CLI project with canonical wiki docs"
        : "project repository with canonical wiki docs";

  return `# ${descriptor.label}

이 문서는 **${descriptor.audienceName}가 이 저장소를 바로 사용할 수 있도록 넘길 때** 쓰는 handoff 문서입니다.

---

## 저장소 접근 위치

### 로컬 경로
\`${localPath}\`

### GitHub
${remoteLine}

### 기본 브랜치
${branchLine}

---

## 이 저장소가 하는 일

이 저장소는 ${repoTypeLine}입니다.

${descriptor.audienceName}는 이 저장소를 **${rules.purpose}** 로 사용해야 합니다.

---

## 먼저 읽어야 할 파일

${readOrderLines}

---

## 작업 규칙

${rules.rules.map((rule) => `- ${rule}`).join("\n")}

---

## 권장 브랜치 전략

- \`${branch || "main"}\`에서 새 브랜치를 만들어 작업
- 의미 있는 결과가 있으면 wiki와 result docs를 같이 업데이트

---

## 사용 후 업데이트 규칙

이 저장소를 사용해서 의미 있는 작업을 했다면 최소한 아래 중 하나는 업데이트해야 합니다.

- \`docs/wiki/Build-Registry.md\`
- 관련 validation / results 문서
- 관련 handoff / quick-start 문서

즉, **사용만 하고 기록을 남기지 않는 방식은 금지**입니다.
`;
}

function executeWikiHandoff(targetRoot, flags) {
  const resolvedRoot = path.resolve(targetRoot);
  ensureDir(resolvedRoot);

  const template = String(flags.template || "generic").toLowerCase();
  const consumers = String(flags.consumers || flags.consumer || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const { handoffFiles, unknownConsumers } = getExpectedHandoffFiles(consumers);
  if (unknownConsumers.length > 0) {
    return {
      command: "wiki-handoff",
      targetRoot: resolvedRoot,
      template,
      status: "fail",
      unknownConsumers,
      createdFiles: [],
      skippedFiles: [],
      recommendations: [`Fix unknown consumer values: ${unknownConsumers.join(", ")}.`],
    };
  }

  const wikiDir = path.join(resolvedRoot, "docs", "wiki");
  const createdFiles = [];
  const skippedFiles = [];
  const wikiExistsAlready = fs.existsSync(wikiDir) && fs.readdirSync(wikiDir, { withFileTypes: true }).length > 0;
  ensureDir(wikiDir);

  if (!wikiExistsAlready) {
    const starterPages = getWikiTemplatePages(template);
    for (const [pageName, contents] of Object.entries(starterPages)) {
      const pagePath = path.join(wikiDir, pageName);
      if (writeFileIfAbsent(pagePath, contents)) {
        createdFiles.push(path.relative(resolvedRoot, pagePath));
      }
    }
  }

  const gitMeta = detectGitMetadata(resolvedRoot);
  const repoUrl = String(flags["repo-url"] || gitMeta.repoUrl || "").trim() || null;
  const branch = String(flags.branch || gitMeta.branch || "main").trim();

  for (const consumer of consumers) {
    const descriptor = getHandoffDescriptor(consumer);
    if (!descriptor) {
      continue;
    }
    const handoffPath = path.join(wikiDir, descriptor.fileName);
    const content = buildHandoffContent({
      descriptor,
      consumer,
      template,
      targetRoot: resolvedRoot,
      repoUrl,
      branch,
      readOrder: getDefaultReadOrder(template, consumer, resolvedRoot),
    });

    if (fs.existsSync(handoffPath)) {
      fs.writeFileSync(handoffPath, content, "utf8");
      skippedFiles.push(path.relative(resolvedRoot, handoffPath));
    } else {
      fs.writeFileSync(handoffPath, content, "utf8");
      createdFiles.push(path.relative(resolvedRoot, handoffPath));
    }

    ensureHomeLink(resolvedRoot, descriptor.fileName, descriptor.label);
  }

  const readmeUpdated = ensureReadmeWikiPointer(resolvedRoot);

  return {
    command: "wiki-handoff",
    targetRoot: resolvedRoot,
    template,
    status: "ok",
    repoUrl,
    branch,
    createdFiles,
    skippedFiles,
    unknownConsumers,
    readmeUpdated,
  };
}

function inspectWikiState(targetRoot, flags) {
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

function executeWikiAudit(targetRoot, flags) {
  return {
    command: "wiki-audit",
    ...inspectWikiState(targetRoot, flags),
  };
}

function quoteArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function buildCliCommand(subcommand, targetRoot, flags = {}) {
  const parts = ["node", ".\\src\\cli.js", subcommand, quoteArg(targetRoot)];
  for (const [key, value] of Object.entries(flags)) {
    if (value === undefined || value === null || value === false || value === "") {
      continue;
    }
    parts.push(`--${key}`);
    parts.push(quoteArg(value));
  }
  return parts.join(" ");
}

function inferSkillRecommendation(task) {
  const normalizedTask = String(task || "").toLowerCase();
  const rules = [
    { id: "security-review", invoke: "$security-review", patterns: ["security review", "보안 리뷰", "security audit"], reason: "요청이 보안 점검 성격입니다." },
    { id: "code-review", invoke: "$code-review", patterns: ["code review", "review this", "리뷰", "머지 전에"], reason: "요청이 코드 리뷰/사전 점검 성격입니다." },
    { id: "deep-interview", invoke: "$deep-interview", patterns: ["don't assume", "모르겠", "불명확", "clarify", "interview"], reason: "요구사항이 불명확하거나 가정 금지 성격입니다." },
    { id: "ralplan", invoke: "$ralplan", patterns: ["plan", "approach", "설계", "어떻게 하지"], reason: "구현보다 계획/합의가 먼저 필요한 작업입니다." },
    { id: "tdd", invoke: "$tdd", patterns: ["tdd", "test first", "테스트 먼저"], reason: "테스트 우선 구현 요청입니다." },
    { id: "team", invoke: "$team", patterns: ["team", "swarm", "parallel", "병렬"], reason: "병렬/협업 실행을 원하는 작업입니다." },
    { id: "autopilot", invoke: "$autopilot", patterns: ["autopilot", "build me", "handle it all", "전부 자동"], reason: "엔드투엔드 자동 실행을 원하는 작업입니다." },
    { id: "ralph", invoke: "$ralph", patterns: ["keep going", "don't stop", "끝까지", "완료까지"], reason: "지속 실행과 검증을 요구하는 작업입니다." },
  ];

  for (const rule of rules) {
    if (rule.patterns.some((pattern) => normalizedTask.includes(pattern))) {
      return {
        kind: "skill",
        id: rule.id,
        invoke: rule.invoke,
        reason: rule.reason,
      };
    }
  }

  return null;
}

function taskMentionsAny(task, patterns) {
  const normalizedTask = String(task || "").toLowerCase();
  return patterns.some((pattern) => normalizedTask.includes(pattern));
}

function executeRecommend(targetRoot, flags) {
  const task = String(flags.task || "").trim();
  const state = inspectWikiState(targetRoot, flags);
  const skillRecommendation = inferSkillRecommendation(task);

  if (skillRecommendation) {
    return {
      command: "recommend",
      targetRoot: state.targetRoot,
      task,
      state,
      recommendation: skillRecommendation,
      alternatives: [],
    };
  }

  const alternatives = [];
  const template = state.template;
  const consumers = String(flags.consumers || "").trim();

  let recommendation;

  if (!state.targetExists || state.missingFiles.length > 0 || !state.readmePointerPresent) {
    recommendation = {
      kind: "cli",
      id: "wiki-bootstrap",
      invoke: buildCliCommand("wiki-bootstrap", targetRoot, { template }),
      reason: "프로젝트 시작 단계이거나 canonical wiki scaffold가 아직 부족합니다.",
    };
    alternatives.push({
      kind: "skill",
      id: "ralplan",
      invoke: "$ralplan",
      reason: "구현 범위 자체가 아직 모호하면 계획부터 정리하는 편이 좋습니다.",
    });
  } else if (!state.buildRegistryPresent && taskMentionsAny(task, ["구현", "완료", "finished", "implemented", "만들었", "추가했"])) {
    recommendation = {
      kind: "cli",
      id: "wiki-register",
      invoke: buildCliCommand("wiki-register", targetRoot, {
        title: "Meaningful implementation",
        summary: "Record what changed and how it was verified.",
        template,
      }),
      reason: "의미 있는 구현이 끝난 반면 Build Registry 기록이 아직 없습니다.",
    };
    alternatives.push({
      kind: "cli",
      id: "wiki-audit",
      invoke: buildCliCommand("wiki-audit", targetRoot, { template, consumers }),
      reason: "등록 후 누락이 없는지 확인할 때 적합합니다.",
    });
  } else if (state.missingHandoffs.length > 0 && consumers && taskMentionsAny(task, ["handoff", "release", "넘겨", "공유", "codex", "gemini", "antigravity"])) {
    recommendation = {
      kind: "cli",
      id: "wiki-handoff",
      invoke: buildCliCommand("wiki-handoff", targetRoot, { template, consumers }),
      reason: "consumer handoff 페이지가 부족한 상태라 먼저 handoff를 생성해야 합니다.",
    };
    alternatives.push({
      kind: "cli",
      id: "wiki-audit",
      invoke: buildCliCommand("wiki-audit", targetRoot, { template, consumers }),
      reason: "handoff 생성 전후 상태를 점검할 때 적합합니다.",
    });
  } else if (taskMentionsAny(task, ["release", "handoff", "마무리", "릴리즈", "release-ready", "handoff-ready", "finish"])) {
    recommendation = {
      kind: "cli",
      id: "wiki-finalize",
      invoke: buildCliCommand("wiki-finalize", targetRoot, { template }),
      reason: "마무리/핸드오프 단계이므로 release checklist와 final state 기록이 필요합니다.",
    };
    alternatives.push({
      kind: "cli",
      id: "wiki-audit",
      invoke: buildCliCommand("wiki-audit", targetRoot, { template, consumers }),
      reason: "최종 handoff 전에 누락 점검을 돌릴 수 있습니다.",
    });
  } else {
    recommendation = {
      kind: "cli",
      id: "wiki-audit",
      invoke: buildCliCommand("wiki-audit", targetRoot, { template, consumers }),
      reason: "현재 상태를 점검하고 다음 누락/우선순위를 찾는 기본 추천입니다.",
    };
    alternatives.push({
      kind: "cli",
      id: "wiki-register",
      invoke: buildCliCommand("wiki-register", targetRoot, { title: "Meaningful update", summary: "Record the latest project change.", template }),
      reason: "이미 의미 있는 작업이 끝났다면 registry 업데이트가 먼저일 수 있습니다.",
    });
  }

  return {
    command: "recommend",
    targetRoot: state.targetRoot,
    task,
    state,
    recommendation,
    alternatives,
  };
}

function executeWikiFinalize(targetRoot, flags) {
  const resolvedRoot = path.resolve(targetRoot);
  if (!fs.existsSync(resolvedRoot)) {
    return {
      command: "wiki-finalize",
      targetRoot: resolvedRoot,
      status: "fail",
      targetExists: false,
      recommendations: ["Create or point to an existing target root before finalizing wiki state."],
    };
  }

  const wikiDir = path.join(resolvedRoot, "docs", "wiki");
  const requestedTemplate = String(flags.template || "generic").toLowerCase();
  const wikiExistsAlready = fs.existsSync(wikiDir) && fs.readdirSync(wikiDir, { withFileTypes: true }).length > 0;
  ensureDir(wikiDir);

  const createdFiles = [];
  if (!wikiExistsAlready) {
    const starterPages = getWikiTemplatePages(requestedTemplate);
    for (const [pageName, contents] of Object.entries(starterPages)) {
      const pagePath = path.join(wikiDir, pageName);
      if (writeFileIfAbsent(pagePath, contents)) {
        createdFiles.push(path.relative(resolvedRoot, pagePath));
      }
    }
  }

  const readmeUpdated = ensureReadmeWikiPointer(resolvedRoot);

  const registryPath = path.join(wikiDir, "Build-Registry.md");
  if (writeFileIfAbsent(
    registryPath,
    `# Build Registry

이 페이지는 프로젝트에서 실제로 만들어진 것과 그 검증 내용을 기록하는 canonical registry입니다.
`
  )) {
    createdFiles.push(path.relative(resolvedRoot, registryPath));
  }

  const checklistPath = path.join(wikiDir, "Release-Checklist.md");
  const checklistRelativePath = path.relative(resolvedRoot, checklistPath);
  const checklistExisted = fs.existsSync(checklistPath);
  const summary = String(flags.summary || "No final summary provided.").trim();
  const verification = String(flags.verification || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  const risks = String(flags.risks || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  const manualSteps = String(flags["manual-steps"] || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  const consumers = String(flags.consumers || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const { handoffFiles, unknownConsumers } = getExpectedHandoffFiles(consumers);
  const handoffStatus = handoffFiles.map((pageName) => {
    const relativePath = path.join("docs", "wiki", pageName);
    return {
      relativePath,
      present: fs.existsSync(path.join(resolvedRoot, relativePath)),
    };
  });

  const checklistLines = [
    "# Release Checklist",
    "",
    "## Finalization Summary",
    summary,
    "",
    "## Verification",
    ...(verification.length > 0 ? verification.map((item) => `- ${item}`) : ["- No verification provided."]),
    "",
    "## Remaining Risks",
    ...(risks.length > 0 ? risks.map((item) => `- ${item}`) : ["- None recorded."]),
    "",
    "## Manual Follow-up",
    ...(manualSteps.length > 0 ? manualSteps.map((item) => `- ${item}`) : ["- None recorded."]),
    "",
    "## Consumer Handoff Status",
    ...(handoffStatus.length > 0
      ? handoffStatus.map((entry) => `- ${entry.relativePath}: ${entry.present ? "present" : "missing"}`)
      : ["- No consumer handoff targets specified."]),
  ];
  fs.writeFileSync(checklistPath, `${checklistLines.join("\n")}\n`, "utf8");
  if (!checklistExisted) {
    createdFiles.push(checklistRelativePath);
  }

  const homeUpdated = ensureHomeLink(resolvedRoot, "Release-Checklist.md", "Release Checklist");
  const generatedAt = new Date().toISOString();
  const registryLines = [
    `\n## Finalize project state`,
    `- Recorded at: ${generatedAt}`,
    `- Summary: ${summary}`,
  ];
  if (verification.length > 0) {
    registryLines.push(`- Verification:`);
    for (const item of verification) {
      registryLines.push(`  - ${item}`);
    }
  }
  if (manualSteps.length > 0) {
    registryLines.push(`- Manual steps:`);
    for (const item of manualSteps) {
      registryLines.push(`  - ${item}`);
    }
  }
  if (risks.length > 0) {
    registryLines.push(`- Remaining risks:`);
    for (const item of risks) {
      registryLines.push(`  - ${item}`);
    }
  }
  fs.appendFileSync(registryPath, `${registryLines.join("\n")}\n`, "utf8");

  const status = unknownConsumers.length > 0 ? "warn" : "ok";

  return {
    command: "wiki-finalize",
    targetRoot: resolvedRoot,
    status,
    createdFiles,
    readmeUpdated,
    homeUpdated,
    checklistPath,
    registryPath,
    unknownConsumers,
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

  if (report.command === "wiki-finalize") {
    return [
      `Command: ${report.command}`,
      `Target root: ${report.targetRoot}`,
      `Status: ${report.status}`,
      `Created files: ${report.createdFiles.length}`,
      `README updated: ${report.readmeUpdated ? "yes" : "no"}`,
      `Home updated: ${report.homeUpdated ? "yes" : "no"}`,
      `Checklist path: ${report.checklistPath}`,
    ].join("\n");
  }

  if (report.command === "wiki-handoff") {
    return [
      `Command: ${report.command}`,
      `Target root: ${report.targetRoot}`,
      `Template: ${report.template}`,
      `Status: ${report.status}`,
      `Created files: ${report.createdFiles.length}`,
      `Updated files: ${report.skippedFiles.length}`,
      `README updated: ${report.readmeUpdated ? "yes" : "no"}`,
    ].join("\n");
  }

  if (report.command === "wiki-mint") {
    const lines = [
      `Command: ${report.command}`,
      `Target root: ${report.targetRoot}`,
      `Format: ${report.format}`,
      `Mode: ${report.mode}`,
      `Status: ${report.status}`,
      `Entries parsed: ${report.entryCount}`,
      `Sensitive scan: ${report.scan.blocked ? `blocked (${report.scan.issues.length} entries)` : "clear"}`,
      `Output path: ${report.outputPath}`,
      `Created file: ${report.created ? "yes" : "no"}`,
      `Registry appended: ${report.registryAppended ? "yes" : "no"}`,
    ];
    for (const issue of report.scan.issues || []) {
      lines.push(`- Sensitive entry: ${issue.title} (${issue.matches.join(", ")})`);
    }
    for (const warning of report.warnings || []) {
      lines.push(`- Warning: ${warning}`);
    }
    return lines.join("\n");
  }

  if (report.command === "recommend") {
    const lines = [
      `Command: ${report.command}`,
      `Target root: ${report.targetRoot}`,
      `Task: ${report.task || "(none provided)"}`,
      `Top recommendation: ${report.recommendation.kind}:${report.recommendation.id}`,
      `Why: ${report.recommendation.reason}`,
      `Invoke: ${report.recommendation.invoke}`,
    ];
    if (report.alternatives?.length) {
      lines.push("Alternatives:");
      for (const alt of report.alternatives) {
        lines.push(`- ${alt.kind}:${alt.id} — ${alt.reason}`);
      }
    }
    return lines.join("\n");
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
  if (command === "wiki-mint") {
    return executeWikiMint(sourceInput, flags);
  }
  if (command === "wiki-audit") {
    return executeWikiAudit(sourceInput, flags);
  }
  if (command === "wiki-finalize") {
    return executeWikiFinalize(sourceInput, flags);
  }
  if (command === "wiki-handoff") {
    return executeWikiHandoff(sourceInput, flags);
  }
  if (command === "recommend") {
    return executeRecommend(sourceInput, flags);
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
  safe-git-migrator wiki-mint <target-root> [--format readme-showcase|x-thread|substack] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dry-run] [--scan-only] [--output-dir <path>] [--report-json]
  safe-git-migrator wiki-audit <target-root> [--template cli|adapter|generic] [--consumers codex,antigravity,gemini]
  safe-git-migrator wiki-finalize <target-root> [--template cli|adapter|generic] [--summary text] [--verification "cmd1; cmd2"] [--risks "r1; r2"] [--manual-steps "s1; s2"]
  safe-git-migrator wiki-handoff <target-root> [--template cli|adapter|generic] [--consumers codex,antigravity,gemini] [--repo-url <url>] [--branch <branch>]
  safe-git-migrator recommend <target-root> --task "<what you want>" [--template cli|adapter|generic] [--consumers codex,antigravity,gemini]

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

  if (!["inspect", "dry-run", "apply", "verify", "rollback", "wiki-bootstrap", "wiki-register", "wiki-mint", "wiki-audit", "wiki-finalize", "wiki-handoff", "recommend"].includes(command)) {
    throw new Error(`Unsupported command: ${command}`);
  }

  if (!source) {
    throw new Error(`Command "${command}" requires a source URL/path or run-id.`);
  }

  const report = await executeMigration(command, source, parsed.flags);
  if (report?.exitCode) {
    process.exitCode = report.exitCode;
  }

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
  parseWikiBuildRegistry,
  scanWikiMintEntries,
};
