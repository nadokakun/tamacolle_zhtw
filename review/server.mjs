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
const zhSnapshotDir = path.join(cacheRoot, "zh_tw_snapshot");
const jpSnapshotDir = path.join(cacheRoot, "ja_noruby_snapshot");
const backupRoot = path.join(cacheRoot, "backups");
const bootstrapPath = path.join(cacheRoot, "bootstrap.json");

const host = process.env.TAMACOLLE_REVIEW_HOST || "127.0.0.1";
const port = Number(process.env.TAMACOLLE_REVIEW_PORT || "8767");

const textEncoder = new TextEncoder();

let bootstrapPromise = null;
const startupStatus = {
  phase: "idle",
  message: "等待初始化",
  detail: "",
  current: 0,
  total: 0,
  busy: true,
  updatedAt: new Date().toISOString(),
};

function setStartupStatus(next) {
  Object.assign(startupStatus, next, { updatedAt: new Date().toISOString() });
}

function getStartupStatus() {
  return {
    ...startupStatus,
    ready: !startupStatus.busy,
  };
}

function jsonResponse(res, statusCode, payload) {
  const body = textEncoder.encode(JSON.stringify(payload, null, 2));
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(body.length),
    "Cache-Control": "no-store",
  });
  res.end(body);
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

async function runBootstrap() {
  setStartupStatus({
    phase: "prepare",
    message: "準備初始化快照",
    detail: "建立本機快取資料夾中...",
    current: 0,
    total: 0,
    busy: true,
  });

  await ensureDir(cacheRoot);
  await ensureDir(backupRoot);
  await ensureDir(zhSnapshotDir);
  await ensureDir(jpSnapshotDir);

  setStartupStatus({
    phase: "scan",
    message: "掃描翻譯檔案",
    detail: "正在整理日文與中文檔名...",
  });

  const files = await listScenarioFiles();

  setStartupStatus({
    phase: "snapshot-zh",
    message: "建立中文快照",
    detail: "正在複製 zh_tw/raw 到本機快取...",
    current: 0,
    total: files.length,
  });

  for (let index = 0; index < files.length; index += 1) {
    const name = files[index];
    const zhSource = path.join(zhDir, name);
    if (await exists(zhSource)) {
      await copyFile(zhSource, path.join(zhSnapshotDir, name));
    }
    setStartupStatus({
      phase: "snapshot-zh",
      message: "建立中文快照",
      detail: name,
      current: index + 1,
      total: files.length,
    });
  }

  setStartupStatus({
    phase: "snapshot-jp",
    message: "建立日文快照",
    detail: "正在複製 ja_noruby/raw 到本機快取...",
    current: 0,
    total: files.length,
  });

  for (let index = 0; index < files.length; index += 1) {
    const name = files[index];
    const jpSource = path.join(jpDir, name);
    if (await exists(jpSource)) {
      await copyFile(jpSource, path.join(jpSnapshotDir, name));
    }
    setStartupStatus({
      phase: "snapshot-jp",
      message: "建立日文快照",
      detail: name,
      current: index + 1,
      total: files.length,
    });
  }

  setStartupStatus({
    phase: "finalize",
    message: "寫入初始化資訊",
    detail: "更新 bootstrap.json...",
    current: files.length,
    total: files.length,
  });

  let previousBootstrap = {};
  if (await exists(bootstrapPath)) {
    try {
      previousBootstrap = JSON.parse(await readUtf8(bootstrapPath));
    } catch {
      previousBootstrap = {};
    }
  }

  const bootstrap = {
    createdAt: previousBootstrap.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    zhSnapshotDir: path.relative(repoRoot, zhSnapshotDir).replace(/\\/g, "/"),
    jpSnapshotDir: path.relative(repoRoot, jpSnapshotDir).replace(/\\/g, "/"),
    fileCount: files.length,
    note: "Local snapshots of zh_tw/raw and ja_noruby/raw.",
  };

  await writeUtf8(bootstrapPath, `${JSON.stringify(bootstrap, null, 2)}\n`);

  setStartupStatus({
    phase: "ready",
    message: "初始化完成",
    detail: `已建立 ${files.length} 個檔案的中日文快照。`,
    current: files.length,
    total: files.length,
    busy: false,
  });

  return bootstrap;
}

async function ensureBootstrap() {
  if (!bootstrapPromise) {
    bootstrapPromise = runBootstrap().catch((error) => {
      setStartupStatus({
        phase: "error",
        message: "初始化失敗",
        detail: error instanceof Error ? error.message : String(error),
        busy: false,
      });
      bootstrapPromise = null;
      throw error;
    });
  }

  return bootstrapPromise;
}

async function resolveSnapshotPath(dirPath, snapshotPath, name) {
  const snapshotFile = path.join(snapshotPath, name);
  return (await exists(snapshotFile)) ? snapshotFile : path.join(dirPath, name);
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
    runGit(["status", "--short"]),
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
    const [jpPath, zhPath] = await Promise.all([
      resolveSnapshotPath(jpDir, jpSnapshotDir, name),
      resolveSnapshotPath(zhDir, zhSnapshotDir, name),
    ]);

    const [jpExists, zhExists] = await Promise.all([exists(jpPath), exists(zhPath)]);
    const [jpText, zhText] = await Promise.all([
      jpExists ? readUtf8(jpPath) : "",
      zhExists ? readUtf8(zhPath) : "",
    ]);

    const proofread = proofreadStatus[name] || {};

    items.push({
      name,
      jpLines: jpText ? splitLines(jpText).length : 0,
      zhLines: zhText ? splitLines(zhText).length : 0,
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

  await ensureBootstrap();
  const [jpPath, zhPath] = await Promise.all([
    resolveSnapshotPath(jpDir, jpSnapshotDir, name),
    resolveSnapshotPath(zhDir, zhSnapshotDir, name),
  ]);

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
    throw new Error("工作樹有未提交變更，請先整理後再同步雲端。");
  }

  const pullResult = await runGit(["pull", "--ff-only", "--autostash", "origin", gitStatus.branch]);
  return {
    ok: true,
    stdout: pullResult.stdout,
    stderr: pullResult.stderr,
  };
}

async function pushChanges(payload) {
  const message = String(payload.message || "").trim() || `review: update translations ${new Date().toISOString().slice(0, 19)}`;
  const statusBefore = await getGitStatus();
  const branch = statusBefore.branch || "main";

  await runGit(["add", "-A"]);

  const staged = await runGit(["status", "--short"]);
  const hasChanges = Boolean(staged.stdout);

  let commitCreated = false;
  if (hasChanges) {
    await runGit(["commit", "-m", message]);
    commitCreated = true;
  }

  let rebaseResult = { stdout: "", stderr: "" };
  try {
    rebaseResult = await runGit(["pull", "--rebase", "--autostash", "origin", branch]);
  } catch (error) {
    const stdout = error.stdout?.trim?.() || "";
    const stderr = error.stderr?.trim?.() || "";
    throw new Error(
      [
        "推送前自動整合遠端變更失敗。",
        "請先處理 rebase 衝突後再重試。",
        stdout,
        stderr,
      ].filter(Boolean).join("\n\n"),
    );
  }

  const pushResult = await runGit(["push", "origin", "HEAD"]);
  const statusAfter = await getGitStatus();

  return {
    ok: true,
    commitCreated,
    message,
    before: statusBefore,
    after: statusAfter,
    stdout: [rebaseResult.stdout, pushResult.stdout].filter(Boolean).join("\n\n"),
    stderr: [rebaseResult.stderr, pushResult.stderr].filter(Boolean).join("\n\n"),
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

  if (req.method === "GET" && url.pathname === "/api/startup-status") {
    jsonResponse(res, 200, getStartupStatus());
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

createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    jsonResponse(res, 500, { error: error instanceof Error ? error.message : String(error) });
  });
}).listen(port, host, () => {
  console.log(`Tamacolle review server: http://${host}:${port}/`);
  console.log(`Repo root: ${repoRoot}`);
});

ensureBootstrap().catch((error) => {
  console.error("Bootstrap failed:", error);
});
