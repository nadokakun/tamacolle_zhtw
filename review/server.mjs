import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, stat, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const reviewDir = path.dirname(__filename);
const repoRoot = path.resolve(reviewDir, "..");
const zhDir = path.join(repoRoot, "zh_tw", "raw");
const jpDir = path.join(repoRoot, "ja_noruby", "raw");
const proofreadPath = path.join(reviewDir, "proofread-status.json");
const cacheRoot = path.join(repoRoot, ".review-cache");
const snapshotDir = path.join(cacheRoot, "zh_tw_snapshot");
const backupRoot = path.join(cacheRoot, "backups");
const bootstrapPath = path.join(cacheRoot, "bootstrap.json");

const host = process.env.TAMACOLLE_REVIEW_HOST || "127.0.0.1";
const port = Number(process.env.TAMACOLLE_REVIEW_PORT || "8767");

const textEncoder = new TextEncoder();

function jsonResponse(res, statusCode, payload) {
  const body = textEncoder.encode(JSON.stringify(payload, null, 2));
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(body.length),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function textResponse(res, statusCode, body, contentType) {
  const encoded = textEncoder.encode(body);
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": String(encoded.length),
    "Cache-Control": "no-store",
  });
  res.end(encoded);
}

async function exists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(targetPath) {
  await mkdir(targetPath, { recursive: true });
}

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n");
}

function splitLines(text) {
  if (!text) {
    return [];
  }

  const lines = normalizeNewlines(text).split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function joinLines(lines, trailingNewline = false) {
  const joined = lines.join("\n");
  return trailingNewline ? `${joined}\n` : joined;
}

async function readUtf8(targetPath) {
  return readFile(targetPath, "utf8");
}

async function writeUtf8(targetPath, content) {
  await writeFile(targetPath, content, "utf8");
}

async function listScenarioFiles() {
  const [zhEntries, jpEntries] = await Promise.all([readdir(zhDir), readdir(jpDir)]);
  const fileSet = new Set();

  for (const name of [...zhEntries, ...jpEntries]) {
    if (name.startsWith("scenario_") && name.endsWith(".txt")) {
      fileSet.add(name);
    }
  }

  return Array.from(fileSet).sort((a, b) => a.localeCompare(b, "en"));
}

async function readProofreadStatus() {
  if (!(await exists(proofreadPath))) {
    return {};
  }

  try {
    const raw = await readUtf8(proofreadPath);
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeProofreadStatus(status) {
  await writeUtf8(proofreadPath, `${JSON.stringify(status, null, 2)}\n`);
}

async function ensureBootstrap() {
  await ensureDir(cacheRoot);
  await ensureDir(backupRoot);

  if (await exists(bootstrapPath)) {
    const raw = await readUtf8(bootstrapPath);
    return JSON.parse(raw);
  }

  await ensureDir(snapshotDir);
  const files = await listScenarioFiles();

  for (const name of files) {
    const source = path.join(zhDir, name);
    if (await exists(source)) {
      await copyFile(source, path.join(snapshotDir, name));
    }
  }

  const bootstrap = {
    createdAt: new Date().toISOString(),
    zhSnapshotDir: path.relative(repoRoot, snapshotDir).replace(/\\/g, "/"),
    fileCount: files.length,
    note: "First-use snapshot of zh_tw/raw.",
  };

  await writeUtf8(bootstrapPath, `${JSON.stringify(bootstrap, null, 2)}\n`);
  return bootstrap;
}

async function runGit(args, options = {}) {
  const result = await execFileAsync("git", args, {
    cwd: repoRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8,
    ...options,
  });
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

async function getGitStatus() {
  const [branchResult, statusResult] = await Promise.all([
    runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
    runGit(["status", "--short", "--", "zh_tw/raw", "review/proofread-status.json"]),
  ]);

  const lines = statusResult.stdout ? statusResult.stdout.split(/\r?\n/) : [];
  const modifiedFiles = [];

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    const filePath = line
      .replace(/^(\?\?|[ MADRCU!]{1,2})\s+/, "")
      .replace(/\\/g, "/");

    if (filePath === line) {
      continue;
    }
    if (filePath.startsWith("zh_tw/raw/")) {
      modifiedFiles.push(path.basename(filePath));
    }
  }

  return {
    branch: branchResult.stdout || "HEAD",
    dirty: lines.length > 0,
    modifiedFiles,
    raw: lines,
  };
}

async function buildFileSummary() {
  const [files, proofreadStatus, gitStatus, bootstrap] = await Promise.all([
    listScenarioFiles(),
    readProofreadStatus(),
    getGitStatus(),
    ensureBootstrap(),
  ]);

  const modifiedSet = new Set(gitStatus.modifiedFiles);
  const items = [];

  for (const name of files) {
    const [jpExists, zhExists] = await Promise.all([
      exists(path.join(jpDir, name)),
      exists(path.join(zhDir, name)),
    ]);

    const [jpText, zhText] = await Promise.all([
      jpExists ? readUtf8(path.join(jpDir, name)) : "",
      zhExists ? readUtf8(path.join(zhDir, name)) : "",
    ]);

    const jpLines = jpText ? splitLines(jpText).length : 0;
    const zhLines = zhText ? splitLines(zhText).length : 0;
    const proofread = proofreadStatus[name] || {};

    items.push({
      name,
      jpLines,
      zhLines,
      proofread: Boolean(proofread.done),
      proofreadAt: proofread.updatedAt || null,
      modified: modifiedSet.has(name),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    fileCount: items.length,
    proofreadCount: items.filter((item) => item.proofread).length,
    modifiedCount: items.filter((item) => item.modified).length,
    files: items,
    git: gitStatus,
    bootstrap,
  };
}

async function readScenario(name) {
  if (!/^scenario_[A-Za-z0-9_]+\.txt$/.test(name)) {
    throw new Error("Invalid file name.");
  }

  const jpPath = path.join(jpDir, name);
  const zhPath = path.join(zhDir, name);

  const [jpText, zhText] = await Promise.all([
    exists(jpPath).then((ok) => (ok ? readUtf8(jpPath) : "")),
    exists(zhPath).then((ok) => (ok ? readUtf8(zhPath) : "")),
  ]);

  return {
    name,
    jp: splitLines(jpText),
    zh: splitLines(zhText),
  };
}

function createMatcher(findText, replaceText, caseSensitive, useRegex) {
  if (!findText) {
    throw new Error("請輸入要尋找的文字。");
  }

  if (useRegex) {
    const flags = caseSensitive ? "g" : "gi";
    const pattern = new RegExp(findText, flags);
    return (text) => {
      let count = 0;
      const replaced = text.replace(pattern, () => {
        count += 1;
        return replaceText;
      });
      return { replaced, count };
    };
  }

  if (caseSensitive) {
    return (text) => {
      const count = text.split(findText).length - 1;
      return {
        replaced: text.replaceAll(findText, replaceText),
        count,
      };
    };
  }

  const pattern = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return (text) => {
    let count = 0;
    const replaced = text.replace(pattern, () => {
      count += 1;
      return replaceText;
    });
    return { replaced, count };
  };
}

async function previewReplace(payload) {
  const matcher = createMatcher(
    payload.findText || "",
    payload.replaceText || "",
    Boolean(payload.caseSensitive),
    Boolean(payload.useRegex),
  );

  const scope = payload.scope === "current" ? "current" : "all";
  const allFiles = await listScenarioFiles();
  const targetFiles = scope === "current" ? [payload.currentFile].filter(Boolean) : allFiles;

  let matchCount = 0;
  let filesMatched = 0;

  for (const name of targetFiles) {
    const scenario = await readScenario(name);
    let fileMatches = 0;

    for (const line of scenario.zh) {
      fileMatches += matcher(line).count;
    }

    if (fileMatches > 0) {
      filesMatched += 1;
      matchCount += fileMatches;
    }
  }

  return { matchCount, filesMatched };
}

function makeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function replaceAll(payload) {
  const matcher = createMatcher(
    payload.findText || "",
    payload.replaceText || "",
    Boolean(payload.caseSensitive),
    Boolean(payload.useRegex),
  );

  const scope = payload.scope === "current" ? "current" : "all";
  const allFiles = await listScenarioFiles();
  const targetFiles = scope === "current" ? [payload.currentFile].filter(Boolean) : allFiles;

  const backupDir = path.join(backupRoot, `replace-${makeTimestamp()}`);
  let touched = 0;
  let totalMatches = 0;

  for (const name of targetFiles) {
    const scenarioPath = path.join(zhDir, name);
    if (!(await exists(scenarioPath))) {
      continue;
    }

    const originalText = await readUtf8(scenarioPath);
    const hadTrailingNewline = /\r?\n$/.test(originalText);
    const lines = splitLines(originalText);
    let fileMatches = 0;
    const nextLines = lines.map((line) => {
      const result = matcher(line);
      fileMatches += result.count;
      return result.replaced;
    });

    if (fileMatches > 0) {
      if (!(await exists(backupDir))) {
        await ensureDir(backupDir);
      }
      await copyFile(scenarioPath, path.join(backupDir, name));
      await writeUtf8(scenarioPath, joinLines(nextLines, hadTrailingNewline));
      touched += 1;
      totalMatches += fileMatches;
    }
  }

  return {
    filesUpdated: touched,
    matchCount: totalMatches,
    backupDir: touched > 0 ? path.relative(repoRoot, backupDir).replace(/\\/g, "/") : "",
  };
}

async function saveLine(payload) {
  const name = payload.name;
  const lineNumber = Number(payload.lineNumber);
  const text = typeof payload.text === "string" ? payload.text : "";

  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    throw new Error("Invalid line number.");
  }

  const scenarioPath = path.join(zhDir, name);
  const currentText = await readUtf8(scenarioPath);
  const hadTrailingNewline = /\r?\n$/.test(currentText);
  const lines = splitLines(currentText);

  while (lines.length < lineNumber) {
    lines.push("");
  }

  lines[lineNumber - 1] = text;
  await writeUtf8(scenarioPath, joinLines(lines, hadTrailingNewline));
  return { ok: true, lineNumber, text };
}

async function setProofread(payload) {
  const name = payload.name;
  const done = Boolean(payload.done);
  const status = await readProofreadStatus();

  status[name] = {
    done,
    updatedAt: new Date().toISOString(),
  };

  await writeProofreadStatus(status);
  return { ok: true, done, updatedAt: status[name].updatedAt };
}

async function syncRemote() {
  const gitStatus = await getGitStatus();
  if (gitStatus.dirty) {
    throw new Error("本機有未提交的翻譯或校對標記，請先提交或推送後再同步。");
  }

  const pullResult = await runGit(["pull", "--ff-only", "origin", "main"]);
  return {
    ok: true,
    stdout: pullResult.stdout,
    stderr: pullResult.stderr,
  };
}

async function pushChanges(payload) {
  const message = String(payload.message || "").trim() || `review: update translations ${new Date().toISOString().slice(0, 19)}`;
  const statusBefore = await getGitStatus();

  await runGit(["add", "zh_tw/raw", "review/proofread-status.json"]);

  const staged = await runGit(["status", "--short", "--", "zh_tw/raw", "review/proofread-status.json"]);
  const hasChanges = Boolean(staged.stdout);

  let commitCreated = false;
  if (hasChanges) {
    await runGit(["commit", "-m", message]);
    commitCreated = true;
  }

  const pushResult = await runGit(["push", "origin", "HEAD"]);
  const statusAfter = await getGitStatus();

  return {
    ok: true,
    commitCreated,
    message,
    before: statusBefore,
    after: statusAfter,
    stdout: pushResult.stdout,
    stderr: pushResult.stderr,
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (filePath.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

async function serveStatic(req, res, pathname) {
  const normalized = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.join(reviewDir, normalized);

  if (!filePath.startsWith(reviewDir)) {
    jsonResponse(res, 403, { error: "Forbidden" });
    return;
  }

  if (!(await exists(filePath))) {
    jsonResponse(res, 404, { error: "Not found" });
    return;
  }

  const body = await readFile(filePath);
  res.writeHead(200, {
    "Content-Type": contentTypeFor(filePath),
    "Content-Length": String(body.length),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    jsonResponse(res, 200, { ok: true, time: new Date().toISOString() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/files") {
    jsonResponse(res, 200, await buildFileSummary());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/file") {
    const name = url.searchParams.get("name");
    if (!name) {
      jsonResponse(res, 400, { error: "Missing file name." });
      return;
    }
    jsonResponse(res, 200, await readScenario(name));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/git-status") {
    jsonResponse(res, 200, await getGitStatus());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/save-line") {
    jsonResponse(res, 200, await saveLine(await readBody(req)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/replace-preview") {
    jsonResponse(res, 200, await previewReplace(await readBody(req)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/replace-all") {
    jsonResponse(res, 200, await replaceAll(await readBody(req)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/proofread") {
    jsonResponse(res, 200, await setProofread(await readBody(req)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sync-remote") {
    jsonResponse(res, 200, await syncRemote());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/git-push") {
    jsonResponse(res, 200, await pushChanges(await readBody(req)));
    return;
  }

  jsonResponse(res, 404, { error: "Unknown API route." });
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url.pathname);
  } catch (error) {
    jsonResponse(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

await ensureBootstrap();

createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    jsonResponse(res, 500, { error: error instanceof Error ? error.message : String(error) });
  });
}).listen(port, host, () => {
  console.log(`Tamacolle review server: http://${host}:${port}/`);
  console.log(`Repo root: ${repoRoot}`);
});
