const DEFAULT_REPO_CONFIG = {
  owner: "nadokakun",
  repo: "tamacolle_zhtw",
  branch: "main",
  zhDir: "zh_tw/raw",
  jpDir: "ja_noruby/raw",
  proofreadPath: "review/proofread-status.json",
};

const STORAGE_KEYS = {
  repoConfig: "tamacolle-review-repo-config",
  sidebarCollapsed: "tamacolle-review-sidebar-collapsed",
};

const DB_NAME = "tamacolle-review-cache";
const DB_VERSION = 1;
const FILE_STORE = "files";
const META_STORE = "meta";
const LINE_INPUT_MIN_HEIGHT = 42;

const state = {
  files: [],
  filteredFiles: [],
  currentName: "",
  currentScenario: null,
  contentSearchMap: null,
  appliedSearchKeyword: "",
  savingLine: new Set(),
  sidebarCollapsed: false,
  renderToken: 0,
  repoConfig: loadRepoConfig(),
  db: null,
  proofreadStatus: {},
  proofreadBaseStatus: {},
  bootstrap: null,
  autoGrowQueue: new Set(),
  autoGrowRaf: 0,
  renderTimer: 0,
};

const elements = {
  main: document.querySelector(".main"),
  sidebarPanel: document.getElementById("sidebarPanel"),
  toggleSidebarBtn: document.getElementById("toggleSidebarBtn"),
  reopenSidebarBtn: document.getElementById("reopenSidebarBtn"),
  fileSearch: document.getElementById("fileSearch"),
  proofreadFilter: document.getElementById("proofreadFilter"),
  fileList: document.getElementById("fileList"),
  fileCount: document.getElementById("fileCount"),
  proofreadCount: document.getElementById("proofreadCount"),
  modifiedCount: document.getElementById("modifiedCount"),
  currentFile: document.getElementById("currentFile"),
  currentMeta: document.getElementById("currentMeta"),
  refreshBtn: document.getElementById("refreshBtn"),
  syncRemoteBtn: document.getElementById("syncRemoteBtn"),
  pushBtn: document.getElementById("pushBtn"),
  configBtn: document.getElementById("configBtn"),
  commitMessage: document.getElementById("commitMessage"),
  replaceFind: document.getElementById("replaceFind"),
  replaceTo: document.getElementById("replaceTo"),
  replaceScope: document.getElementById("replaceScope"),
  caseSensitive: document.getElementById("caseSensitive"),
  useRegex: document.getElementById("useRegex"),
  replacePreviewBtn: document.getElementById("replacePreviewBtn"),
  replaceRunBtn: document.getElementById("replaceRunBtn"),
  replaceStatus: document.getElementById("replaceStatus"),
  comparePane: document.getElementById("comparePane"),
  startupStatusBar: document.getElementById("startupStatusBar"),
  startupStatusText: document.getElementById("startupStatusText"),
  startupStatusDetail: document.getElementById("startupStatusDetail"),
  startupStatusProgress: document.getElementById("startupStatusProgress"),
  repoSummary: document.getElementById("repoSummary"),
  toast: document.getElementById("toast"),
  progressModal: document.getElementById("progressModal"),
  progressTitle: document.getElementById("progressTitle"),
  progressMessage: document.getElementById("progressMessage"),
  progressLog: document.getElementById("progressLog"),
  progressSpinner: document.getElementById("progressSpinner"),
  progressCloseBtn: document.getElementById("progressCloseBtn"),
  configModal: document.getElementById("configModal"),
  configForm: document.getElementById("configForm"),
  configOwner: document.getElementById("configOwner"),
  configRepo: document.getElementById("configRepo"),
  configBranch: document.getElementById("configBranch"),
  configToken: document.getElementById("configToken"),
  configCloseBtn: document.getElementById("configCloseBtn"),
  configStatus: document.getElementById("configStatus"),
  markDoneBtn: document.getElementById("markDoneBtn"),
  markTodoBtn: document.getElementById("markTodoBtn"),
};

function loadRepoConfig() {
  const saved = localStorage.getItem(STORAGE_KEYS.repoConfig);
  if (!saved) {
    return { ...DEFAULT_REPO_CONFIG, token: "" };
  }
  try {
    const parsed = JSON.parse(saved);
    return {
      ...DEFAULT_REPO_CONFIG,
      ...parsed,
      token: typeof parsed.token === "string" ? parsed.token : "",
    };
  } catch {
    return { ...DEFAULT_REPO_CONFIG, token: "" };
  }
}

function saveRepoConfig() {
  localStorage.setItem(STORAGE_KEYS.repoConfig, JSON.stringify(state.repoConfig));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeNewlines(text) {
  return String(text ?? "").replace(/\r\n/g, "\n");
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

function decodeBase64Utf8(base64) {
  const binary = atob(base64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function compareObjects(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

function getReviewStage(proofread) {
  if (!proofread || typeof proofread !== "object") {
    return "todo";
  }
  if (proofread.state === "wip") {
    return "wip";
  }
  if (proofread.state === "done" || proofread.done) {
    return "done";
  }
  return "todo";
}

function getReviewLabel(stage) {
  if (stage === "wip") {
    return "校對中";
  }
  if (stage === "done") {
    return "已校對";
  }
  return "未校對";
}

function getReviewClass(stage) {
  if (stage === "wip") {
    return "is-wip";
  }
  if (stage === "done") {
    return "is-done";
  }
  return "is-todo";
}

function compareFiles(left, right) {
  const stageRank = { wip: 0, todo: 1, done: 2 };
  const leftRank = stageRank[left.reviewStage] ?? 9;
  const rightRank = stageRank[right.reviewStage] ?? 9;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  return left.name.localeCompare(right.name, "en");
}

function updateRepoSummary() {
  const { owner, repo, branch } = state.repoConfig;
  elements.repoSummary.textContent = `${owner}/${repo}@${branch}`;
}

function showToast(message, type = "info") {
  elements.toast.textContent = message;
  elements.toast.dataset.type = type;
  elements.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 2600);
}

function updateStartupBar(status) {
  const progressText = status.total > 0 ? `${status.current}/${status.total}` : "";
  elements.startupStatusText.textContent = status.message || "準備中";
  elements.startupStatusDetail.textContent = status.detail || "";
  elements.startupStatusProgress.textContent = progressText;
  elements.startupStatusBar.classList.toggle("is-busy", Boolean(status.busy));
  elements.startupStatusBar.classList.toggle("is-ready", !status.busy);
}

function setProgressState({ title, message, log = "", closable = false, busy = true }) {
  elements.progressTitle.textContent = title;
  elements.progressMessage.textContent = message;
  elements.progressSpinner.hidden = !busy;
  elements.progressCloseBtn.hidden = !closable;
  elements.progressLog.hidden = !log;
  elements.progressLog.textContent = log;
}

function openProgressModal(config) {
  setProgressState(config);
  elements.progressModal.hidden = false;
}

function closeProgressModal() {
  elements.progressModal.hidden = true;
}

function openConfigModal() {
  elements.configOwner.value = state.repoConfig.owner;
  elements.configRepo.value = state.repoConfig.repo;
  elements.configBranch.value = state.repoConfig.branch;
  elements.configToken.value = state.repoConfig.token || "";
  elements.configStatus.textContent = "權杖只會儲存在目前瀏覽器。";
  elements.configModal.hidden = false;
}

function closeConfigModal() {
  elements.configModal.hidden = true;
}

function applySidebarState() {
  elements.main.classList.toggle("is-sidebar-collapsed", state.sidebarCollapsed);
  elements.sidebarPanel.classList.toggle("is-collapsed", state.sidebarCollapsed);
  elements.toggleSidebarBtn.textContent = state.sidebarCollapsed ? "展開" : "收合";
  elements.reopenSidebarBtn.classList.toggle("is-visible", state.sidebarCollapsed);
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, state.sidebarCollapsed ? "1" : "0");
  applySidebarState();
}

function queueAutoGrow(textarea) {
  state.autoGrowQueue.add(textarea);
  if (state.autoGrowRaf) {
    return;
  }
  state.autoGrowRaf = requestAnimationFrame(() => {
    for (const item of state.autoGrowQueue) {
      item.style.height = "auto";
      const nextHeight = Math.max(item.scrollHeight, LINE_INPUT_MIN_HEIGHT);
      if (Number.parseInt(item.style.height || "0", 10) !== nextHeight) {
        item.style.height = `${nextHeight}px`;
      } else {
        item.style.height = `${nextHeight}px`;
      }
    }
    state.autoGrowQueue.clear();
    state.autoGrowRaf = 0;
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function requestDb() {
  if (state.db) {
    return state.db;
  }
  state.db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        const store = db.createObjectStore(FILE_STORE, { keyPath: "cacheKey" });
        store.createIndex("lang", "lang", { unique: false });
        store.createIndex("name", "name", { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return state.db;
}

async function txStore(storeName, mode, runner) {
  const db = await requestDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    Promise.resolve()
      .then(() => runner(store))
      .then((value) => {
        result = value;
      })
      .catch((error) => {
        tx.abort();
        reject(error);
      });
  });
}

async function putMeta(key, value) {
  return txStore(META_STORE, "readwrite", async (store) => {
    await requestToPromise(store.put({ key, value }));
  });
}

async function getMeta(key, fallback = null) {
  return txStore(META_STORE, "readonly", async (store) => {
    const record = await requestToPromise(store.get(key));
    return record ? record.value : fallback;
  });
}

async function clearFiles() {
  return txStore(FILE_STORE, "readwrite", async (store) => {
    await requestToPromise(store.clear());
  });
}

async function putFileRecord(record) {
  return txStore(FILE_STORE, "readwrite", async (store) => {
    await requestToPromise(store.put(record));
  });
}

async function getFileRecord(lang, name) {
  return txStore(FILE_STORE, "readonly", async (store) => requestToPromise(store.get(`${lang}:${name}`)));
}

async function getAllFileRecords() {
  return txStore(FILE_STORE, "readonly", async (store) => requestToPromise(store.getAll()));
}

async function initCacheState() {
  state.proofreadStatus = await getMeta("proofreadStatus", {});
  state.proofreadBaseStatus = await getMeta("proofreadBaseStatus", {});
  state.bootstrap = await getMeta("bootstrap", null);
}

async function githubRequest(endpoint, options = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...options.headers,
  };
  if (state.repoConfig.token) {
    headers.Authorization = `Bearer ${state.repoConfig.token}`;
  }
  const response = await fetch(`https://api.github.com${endpoint}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    let message = `GitHub API 失敗 (${response.status})`;
    try {
      const data = await response.json();
      if (data.message) {
        message = data.message;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return response.json();
}

function repoApiPath(pathname) {
  const { owner, repo } = state.repoConfig;
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${pathname}`;
}

async function getBranchRef() {
  return githubRequest(repoApiPath(`/git/ref/heads/${encodeURIComponent(state.repoConfig.branch)}`));
}

async function getCommit(commitSha) {
  return githubRequest(repoApiPath(`/git/commits/${commitSha}`));
}

async function getTree(treeSha) {
  return githubRequest(repoApiPath(`/git/trees/${treeSha}?recursive=1`));
}

async function getBlob(blobSha) {
  return githubRequest(repoApiPath(`/git/blobs/${blobSha}`));
}

async function createBlob(content) {
  return githubRequest(repoApiPath("/git/blobs"), {
    method: "POST",
    body: { content, encoding: "utf-8" },
  });
}

async function createTree(baseTreeSha, tree) {
  return githubRequest(repoApiPath("/git/trees"), {
    method: "POST",
    body: { base_tree: baseTreeSha, tree },
  });
}

async function createCommit(message, treeSha, parentSha) {
  return githubRequest(repoApiPath("/git/commits"), {
    method: "POST",
    body: { message, tree: treeSha, parents: [parentSha] },
  });
}

async function updateBranchRef(commitSha) {
  return githubRequest(repoApiPath(`/git/refs/heads/${encodeURIComponent(state.repoConfig.branch)}`), {
    method: "PATCH",
    body: { sha: commitSha, force: false },
  });
}

async function loadProofreadBlob(entries) {
  const proofreadEntry = entries.find((entry) => entry.path === state.repoConfig.proofreadPath);
  if (!proofreadEntry) {
    return {};
  }
  const blob = await getBlob(proofreadEntry.sha);
  try {
    return JSON.parse(decodeBase64Utf8(blob.content) || "{}");
  } catch {
    return {};
  }
}

function isScenarioPath(pathname, baseDir) {
  return pathname.startsWith(`${baseDir}/`) && pathname.endsWith(".txt");
}

function scenarioNameFromPath(pathname) {
  return pathname.slice(pathname.lastIndexOf("/") + 1);
}

async function bootstrapCache(onProgress = () => {}) {
  onProgress({
    message: "連線 GitHub 中",
    detail: "正在讀取分支與檔案樹…",
    current: 0,
    total: 0,
    busy: true,
  });

  const ref = await getBranchRef();
  const commit = await getCommit(ref.object.sha);
  const tree = await getTree(commit.tree.sha);
  const entries = Array.isArray(tree.tree) ? tree.tree : [];
  const proofreadStatus = await loadProofreadBlob(entries);
  const jpEntries = entries
    .filter((entry) => entry.type === "blob" && isScenarioPath(entry.path, state.repoConfig.jpDir))
    .map((entry) => ({ ...entry, lang: "jp", name: scenarioNameFromPath(entry.path) }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  const zhEntries = entries
    .filter((entry) => entry.type === "blob" && isScenarioPath(entry.path, state.repoConfig.zhDir))
    .map((entry) => ({ ...entry, lang: "zh", name: scenarioNameFromPath(entry.path) }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  await clearFiles();
  const queue = [...jpEntries, ...zhEntries];
  const total = queue.length;
  let current = 0;

  async function worker() {
    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry) {
        return;
      }
      onProgress({
        message: entry.lang === "jp" ? "下載日文快照" : "下載中文快照",
        detail: entry.name,
        current,
        total,
        busy: true,
      });
      const blob = await getBlob(entry.sha);
      const text = decodeBase64Utf8(blob.content);
      await putFileRecord({
        cacheKey: `${entry.lang}:${entry.name}`,
        lang: entry.lang,
        name: entry.name,
        path: entry.path,
        sha: entry.sha,
        baseText: text,
        text,
        trailingNewline: /\n$/.test(text),
        modified: false,
        updatedAt: new Date().toISOString(),
      });
      current += 1;
      onProgress({
        message: entry.lang === "jp" ? "下載日文快照" : "下載中文快照",
        detail: entry.name,
        current,
        total,
        busy: true,
      });
    }
  }

  await Promise.all(Array.from({ length: 6 }, () => worker()));

  state.proofreadStatus = proofreadStatus;
  state.proofreadBaseStatus = JSON.parse(JSON.stringify(proofreadStatus));
  state.bootstrap = {
    owner: state.repoConfig.owner,
    repo: state.repoConfig.repo,
    branch: state.repoConfig.branch,
    commitSha: ref.object.sha,
    treeSha: commit.tree.sha,
    fileCount: Math.max(jpEntries.length, zhEntries.length),
    updatedAt: new Date().toISOString(),
  };
  await putMeta("proofreadStatus", state.proofreadStatus);
  await putMeta("proofreadBaseStatus", state.proofreadBaseStatus);
  await putMeta("bootstrap", state.bootstrap);

  onProgress({
    message: "初始化完成",
    detail: `已快取 ${state.bootstrap.fileCount} 個檔案。`,
    current: total,
    total,
    busy: false,
  });
}

async function ensureCacheReady(forceRemote = false) {
  await initCacheState();
  const bootstrap = state.bootstrap;
  const configChanged = !bootstrap
    || bootstrap.owner !== state.repoConfig.owner
    || bootstrap.repo !== state.repoConfig.repo
    || bootstrap.branch !== state.repoConfig.branch;

  if (!forceRemote && bootstrap && !configChanged) {
    updateStartupBar({
      message: "已使用本機快取",
      detail: `${bootstrap.owner}/${bootstrap.repo}@${bootstrap.branch}`,
      current: bootstrap.fileCount,
      total: bootstrap.fileCount,
      busy: false,
    });
    return;
  }

  await bootstrapCache((status) => updateStartupBar(status));
}

async function getLocalDataset() {
  const records = await getAllFileRecords();
  const byName = new Map();
  for (const record of records) {
    if (!byName.has(record.name)) {
      byName.set(record.name, {});
    }
    byName.get(record.name)[record.lang] = record;
  }
  return byName;
}

function fileHasProofreadChange(name) {
  return !compareObjects(state.proofreadStatus[name], state.proofreadBaseStatus[name]);
}

async function buildFileSummary() {
  const byName = await getLocalDataset();
  const names = Array.from(byName.keys()).sort((a, b) => a.localeCompare(b, "en"));
  const files = names.map((name) => {
    const current = byName.get(name) || {};
    const jpRecord = current.jp;
    const zhRecord = current.zh;
    const stage = getReviewStage(state.proofreadStatus[name]);
    return {
      name,
      jpLines: jpRecord ? splitLines(jpRecord.text).length : 0,
      zhLines: zhRecord ? splitLines(zhRecord.text).length : 0,
      proofread: stage === "done",
      reviewStage: stage,
      proofreadAt: state.proofreadStatus[name]?.updatedAt || null,
      modified: Boolean(zhRecord?.modified) || fileHasProofreadChange(name),
    };
  });
  files.sort(compareFiles);
  return {
    fileCount: files.length,
    proofreadCount: files.filter((file) => file.reviewStage === "done").length,
    modifiedCount: files.filter((file) => file.modified).length,
    files,
  };
}

function updateMeta(summary) {
  elements.fileCount.textContent = String(summary.fileCount);
  elements.proofreadCount.textContent = String(summary.proofreadCount);
  elements.modifiedCount.textContent = String(summary.modifiedCount);
}

async function refreshSummary(keepSelection = true) {
  const summary = await buildFileSummary();
  state.files = summary.files;
  updateMeta(summary);
  await refreshContentSearch();
  renderFileList();
  if (keepSelection && state.currentName && !state.files.some((file) => file.name === state.currentName) && state.files[0]) {
    await loadScenario(state.files[0].name);
  }
  return summary;
}

function updateCountersFromState() {
  updateMeta({
    fileCount: state.files.length,
    proofreadCount: state.files.filter((file) => file.reviewStage === "done").length,
    modifiedCount: state.files.filter((file) => file.modified).length,
  });
}

function updateFileStateEntry(name, changes) {
  const target = state.files.find((file) => file.name === name);
  if (!target) {
    return;
  }
  Object.assign(target, changes);
  state.files.sort(compareFiles);
  updateCountersFromState();
}

function filteredFiles() {
  const keyword = state.appliedSearchKeyword;
  const filter = elements.proofreadFilter.value;
  state.filteredFiles = state.files.filter((file) => {
    const matchesKeyword = !keyword || state.contentSearchMap?.has(file.name);
    const matchesFilter =
      filter === "all"
      || (filter === "done" && file.reviewStage === "done")
      || (filter === "wip" && file.reviewStage === "wip")
      || (filter === "todo" && file.reviewStage === "todo")
      || (filter === "modified" && file.modified);
    return matchesKeyword && matchesFilter;
  });
  state.filteredFiles.sort(compareFiles);
}

function renderFileList() {
  filteredFiles();
  elements.fileList.innerHTML = "";
  if (state.filteredFiles.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "找不到符合條件的檔案。";
    elements.fileList.appendChild(empty);
    return;
  }
  for (const file of state.filteredFiles) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `file-item${file.name === state.currentName ? " is-active" : ""}`;
    button.dataset.name = file.name;
    const matchedCount = state.contentSearchMap?.get(file.name) || 0;
    button.innerHTML = `
      <strong>${escapeHtml(file.name)}</strong>
      <span>${file.jpLines} / ${file.zhLines} 行</span>
      <span class="pill ${getReviewClass(file.reviewStage)}">${getReviewLabel(file.reviewStage)}</span>
      ${matchedCount > 0 ? `<span class="pill is-modified">命中 ${matchedCount}</span>` : ""}
      ${file.modified ? '<span class="pill is-modified">已修改</span>' : ""}
    `;
    button.addEventListener("click", () => loadScenario(file.name));
    elements.fileList.appendChild(button);
  }
}

async function searchZhFiles(keyword) {
  const normalizedKeyword = String(keyword || "").trim();
  if (!normalizedKeyword) {
    return { files: [] };
  }
  const records = await getAllFileRecords();
  const matches = [];
  for (const record of records) {
    if (record.lang !== "zh") {
      continue;
    }
    let count = 0;
    let cursor = 0;
    while (true) {
      const found = record.text.indexOf(normalizedKeyword, cursor);
      if (found === -1) {
        break;
      }
      count += 1;
      cursor = found + normalizedKeyword.length;
    }
    if (count > 0) {
      matches.push({ name: record.name, matchCount: count });
    }
  }
  matches.sort((a, b) => (b.matchCount - a.matchCount) || a.name.localeCompare(b.name, "en"));
  return { files: matches };
}

async function refreshContentSearch() {
  if (!state.appliedSearchKeyword) {
    state.contentSearchMap = null;
    return;
  }
  const result = await searchZhFiles(state.appliedSearchKeyword);
  state.contentSearchMap = new Map(result.files.map((file) => [file.name, file.matchCount]));
}

async function applyContentSearch() {
  state.appliedSearchKeyword = elements.fileSearch.value.trim();
  await refreshContentSearch();
  renderFileList();
  elements.fileList.scrollTop = 0;
}

async function readScenario(name) {
  const [jpRecord, zhRecord] = await Promise.all([getFileRecord("jp", name), getFileRecord("zh", name)]);
  return {
    name,
    jp: splitLines(jpRecord?.text || ""),
    zh: splitLines(zhRecord?.text || ""),
  };
}

function createCompareRow(lineNo, jpLine, zhLine) {
  const row = document.createElement("article");
  row.className = "compare-row";
  row.dataset.lineNumber = String(lineNo);

  const jpCell = document.createElement("div");
  jpCell.className = "compare-cell compare-cell-jp";
  jpCell.innerHTML = `
    <span class="line-no">${lineNo}</span>
    <div class="line-text">${escapeHtml(jpLine ?? "")}</div>
  `;

  const zhCell = document.createElement("div");
  zhCell.className = "compare-cell compare-cell-zh";

  const no = document.createElement("span");
  no.className = "line-no";
  no.textContent = String(lineNo);

  const editor = document.createElement("div");
  editor.className = "line-editor";

  const input = document.createElement("textarea");
  input.className = "line-input";
  input.rows = 1;
  input.value = zhLine ?? "";
  input.dataset.lineNumber = String(lineNo);
  queueAutoGrow(input);

  const saveState = document.createElement("span");
  saveState.className = "save-state";
  saveState.textContent = "已儲存";
  saveState.dataset.state = "saved";

  input.addEventListener("input", () => {
    saveState.textContent = "未儲存";
    saveState.dataset.pending = "true";
    saveState.dataset.state = "pending";
    if (input.value.includes("\n") || input.scrollHeight > LINE_INPUT_MIN_HEIGHT + 4) {
      queueAutoGrow(input);
    }
  });

  input.addEventListener("focus", () => queueAutoGrow(input));
  input.addEventListener("keydown", async (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      await saveLine(lineNo, input, saveState);
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      await saveLine(lineNo, input, saveState);
    }
  });
  input.addEventListener("blur", async () => {
    if (saveState.dataset.pending === "true") {
      await saveLine(lineNo, input, saveState);
    }
  });

  editor.append(input, saveState);
  zhCell.append(no, editor);
  row.append(jpCell, zhCell);
  return row;
}

async function renderScenario() {
  const scenario = state.currentScenario;
  const renderToken = ++state.renderToken;
  if (state.renderTimer) {
    clearTimeout(state.renderTimer);
    state.renderTimer = 0;
  }
  if (!scenario) {
    elements.currentFile.textContent = "尚未選取檔案";
    elements.currentMeta.textContent = "";
    elements.comparePane.innerHTML = '<div class="empty">請先選擇檔案。</div>';
    return;
  }
  elements.currentFile.textContent = scenario.name;
  const maxLines = Math.max(scenario.jp.length, scenario.zh.length);
  elements.currentMeta.textContent = `日文 ${scenario.jp.length} 行 | 中文 ${scenario.zh.length} 行`;
  elements.comparePane.innerHTML = '<div class="empty">載入比對內容中…</div>';
  const list = document.createElement("div");
  list.className = "compare-list";
  elements.comparePane.innerHTML = "";
  elements.comparePane.appendChild(list);

  const firstBatchSize = maxLines > 12000 ? 40 : 80;
  const batchSize = maxLines > 12000 ? 80 : 160;

  function appendRange(start, size) {
    if (renderToken !== state.renderToken) {
      return start;
    }
    const fragment = document.createDocumentFragment();
    const end = Math.min(start + size, maxLines);
    for (let index = start; index < end; index += 1) {
      fragment.appendChild(createCompareRow(index + 1, scenario.jp[index] ?? "", scenario.zh[index] ?? ""));
    }
    list.appendChild(fragment);
    elements.currentMeta.textContent = `日文 ${scenario.jp.length} 行 | 中文 ${scenario.zh.length} 行 | 已載入 ${end}/${maxLines}`;
    return end;
  }

  let rendered = appendRange(0, firstBatchSize);
  if (renderToken !== state.renderToken) {
    return;
  }

  const appendDeferred = () => {
    if (renderToken !== state.renderToken) {
      return;
    }
    rendered = appendRange(rendered, batchSize);
    if (rendered < maxLines) {
      state.renderTimer = setTimeout(appendDeferred, 0);
      return;
    }
    state.renderTimer = 0;
    elements.currentMeta.textContent = `日文 ${scenario.jp.length} 行 | 中文 ${scenario.zh.length} 行`;
  };

  if (rendered < maxLines) {
    state.renderTimer = setTimeout(appendDeferred, 0);
  } else {
    elements.currentMeta.textContent = `日文 ${scenario.jp.length} 行 | 中文 ${scenario.zh.length} 行`;
  }
}

async function loadScenario(name) {
  state.currentName = name;
  renderFileList();
  elements.currentFile.textContent = `${name} 載入中…`;
  elements.currentMeta.textContent = "正在讀取本機快取…";
  state.currentScenario = await readScenario(name);
  await renderScenario();
}

async function persistZhScenario(name, nextText, trailingNewline) {
  const record = await getFileRecord("zh", name);
  if (!record) {
    throw new Error(`找不到中文檔案：${name}`);
  }
  await putFileRecord({
    ...record,
    text: nextText,
    trailingNewline,
    modified: nextText !== record.baseText,
    updatedAt: new Date().toISOString(),
  });
}

async function saveLine(lineNo, input, saveState) {
  const key = `${state.currentName}:${lineNo}`;
  if (state.savingLine.has(key)) {
    return;
  }
  state.savingLine.add(key);
  saveState.textContent = "儲存中…";
  saveState.dataset.state = "saving";
  try {
    const record = await getFileRecord("zh", state.currentName);
    if (!record) {
      throw new Error("找不到中文檔案快取。");
    }
    const lines = splitLines(record.text);
    while (lines.length < lineNo) {
      lines.push("");
    }
    lines[lineNo - 1] = input.value;
    const nextText = joinLines(lines, record.trailingNewline);
    await persistZhScenario(state.currentName, nextText, record.trailingNewline);
    state.currentScenario.zh[lineNo - 1] = input.value;
    saveState.textContent = "已儲存";
    saveState.dataset.state = "saved";
    delete saveState.dataset.pending;
    updateFileStateEntry(state.currentName, { modified: nextText !== record.baseText });
    renderFileList();
  } catch (error) {
    saveState.textContent = "儲存失敗";
    saveState.dataset.state = "error";
    showToast(error.message, "error");
  } finally {
    state.savingLine.delete(key);
  }
}

function createMatcher(findText, replaceText, caseSensitive, useRegex) {
  if (!findText) {
    throw new Error("請先輸入要尋找的內容。");
  }
  if (useRegex) {
    const pattern = new RegExp(findText, caseSensitive ? "g" : "gi");
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
    return (text) => ({ replaced: text.replaceAll(findText, replaceText), count: text.split(findText).length - 1 });
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

async function previewReplace() {
  const matcher = createMatcher(elements.replaceFind.value, elements.replaceTo.value, elements.caseSensitive.checked, elements.useRegex.checked);
  const targetNames = elements.replaceScope.value === "current"
    ? [state.currentName].filter(Boolean)
    : (await getAllFileRecords()).filter((record) => record.lang === "zh").map((record) => record.name);
  let filesMatched = 0;
  let matchCount = 0;
  for (const name of new Set(targetNames)) {
    const record = await getFileRecord("zh", name);
    if (!record) {
      continue;
    }
    let fileMatches = 0;
    for (const line of splitLines(record.text)) {
      fileMatches += matcher(line).count;
    }
    if (fileMatches > 0) {
      filesMatched += 1;
      matchCount += fileMatches;
    }
  }
  elements.replaceStatus.textContent = `預計影響 ${filesMatched} 個檔案，共 ${matchCount} 處。`;
}

async function runReplace() {
  const matcher = createMatcher(elements.replaceFind.value, elements.replaceTo.value, elements.caseSensitive.checked, elements.useRegex.checked);
  const targetNames = elements.replaceScope.value === "current"
    ? [state.currentName].filter(Boolean)
    : (await getAllFileRecords()).filter((record) => record.lang === "zh").map((record) => record.name);
  let filesUpdated = 0;
  let matchCount = 0;
  for (const name of new Set(targetNames)) {
    const record = await getFileRecord("zh", name);
    if (!record) {
      continue;
    }
    let fileMatches = 0;
    const nextLines = splitLines(record.text).map((line) => {
      const result = matcher(line);
      fileMatches += result.count;
      return result.replaced;
    });
    if (fileMatches > 0) {
      filesUpdated += 1;
      matchCount += fileMatches;
      await persistZhScenario(name, joinLines(nextLines, record.trailingNewline), record.trailingNewline);
      updateFileStateEntry(name, { modified: true });
    }
  }
  renderFileList();
  if (state.currentName) {
    await loadScenario(state.currentName);
  }
  elements.replaceStatus.textContent = `已更新 ${filesUpdated} 個檔案，共 ${matchCount} 處。`;
}

async function setReviewStage(stage) {
  if (!state.currentName) {
    return;
  }
  state.proofreadStatus = {
    ...state.proofreadStatus,
    [state.currentName]: {
      state: stage,
      done: stage === "done",
      updatedAt: new Date().toISOString(),
    },
  };
  await putMeta("proofreadStatus", state.proofreadStatus);
  updateFileStateEntry(state.currentName, {
    reviewStage: stage,
    proofread: stage === "done",
    modified: fileHasProofreadChange(state.currentName) || state.files.find((file) => file.name === state.currentName)?.modified,
  });
  renderFileList();
}

function hasPendingChanges() {
  return state.files.some((file) => file.modified) || !compareObjects(state.proofreadStatus, state.proofreadBaseStatus);
}

async function captureLocalOverlay() {
  const modifiedZhRecords = (await getAllFileRecords())
    .filter((record) => record.lang === "zh" && record.modified)
    .map((record) => ({
      name: record.name,
      text: record.text,
      trailingNewline: record.trailingNewline,
      updatedAt: record.updatedAt,
    }));
  return {
    modifiedZhRecords,
    proofreadStatus: JSON.parse(JSON.stringify(state.proofreadStatus || {})),
    proofreadBaseStatus: JSON.parse(JSON.stringify(state.proofreadBaseStatus || {})),
  };
}

async function restoreLocalOverlay(overlay) {
  for (const record of overlay.modifiedZhRecords) {
    const remoteRecord = await getFileRecord("zh", record.name);
    if (!remoteRecord) {
      continue;
    }
    await putFileRecord({
      ...remoteRecord,
      text: record.text,
      trailingNewline: record.trailingNewline,
      modified: true,
      updatedAt: record.updatedAt || new Date().toISOString(),
    });
  }
  state.proofreadStatus = overlay.proofreadStatus;
  state.proofreadBaseStatus = overlay.proofreadBaseStatus;
  await putMeta("proofreadStatus", state.proofreadStatus);
  await putMeta("proofreadBaseStatus", state.proofreadBaseStatus);
}

async function syncRemoteWithOverlay() {
  const overlay = await captureLocalOverlay();
  const hasOverlay = overlay.modifiedZhRecords.length > 0 || !compareObjects(overlay.proofreadStatus, overlay.proofreadBaseStatus);
  await bootstrapCache((status) => {
    updateStartupBar(status);
    setProgressState({
      title: "同步雲端",
      message: status.detail ? `${status.message}：${status.detail}` : status.message,
      log: "",
      busy: status.busy,
      closable: !status.busy,
    });
  });
  if (hasOverlay) {
    await restoreLocalOverlay(overlay);
  }
}

async function pushChanges() {
  if (!state.repoConfig.token) {
    throw new Error("請先在 GitHub 設定填入 Personal Access Token。");
  }
  let latestRef = await getBranchRef();
  if (state.bootstrap?.commitSha && latestRef.object.sha !== state.bootstrap.commitSha) {
    await syncRemoteWithOverlay();
    latestRef = await getBranchRef();
  }

  const allRecords = await getAllFileRecords();
  const modifiedRecords = allRecords.filter((record) => record.lang === "zh" && record.modified);
  const proofreadChanged = !compareObjects(state.proofreadStatus, state.proofreadBaseStatus);
  if (modifiedRecords.length === 0 && !proofreadChanged) {
    return { commitCreated: false, message: "沒有需要推送的變更。" };
  }

  const commitMessage = String(elements.commitMessage.value || "").trim()
    || `review: update translations ${new Date().toISOString().slice(0, 19)}`;
  const baseCommit = await getCommit(latestRef.object.sha);
  const treeEntries = [];
  const changedBlobShas = new Map();
  let completed = 0;
  const total = modifiedRecords.length + (proofreadChanged ? 1 : 0);

  for (const record of modifiedRecords) {
    completed += 1;
    setProgressState({
      title: "推送 GitHub",
      message: `建立 blob ${completed}/${total}`,
      log: record.path,
      busy: true,
      closable: false,
    });
    const blob = await createBlob(record.text);
    changedBlobShas.set(record.cacheKey, blob.sha);
    treeEntries.push({ path: record.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  if (proofreadChanged) {
    completed += 1;
    setProgressState({
      title: "推送 GitHub",
      message: `建立 blob ${completed}/${total}`,
      log: state.repoConfig.proofreadPath,
      busy: true,
      closable: false,
    });
    const blob = await createBlob(`${JSON.stringify(state.proofreadStatus, null, 2)}\n`);
    treeEntries.push({ path: state.repoConfig.proofreadPath, mode: "100644", type: "blob", sha: blob.sha });
  }

  setProgressState({
    title: "推送 GitHub",
    message: "建立 tree 與 commit…",
    log: treeEntries.map((entry) => entry.path).join("\n"),
    busy: true,
    closable: false,
  });

  const tree = await createTree(baseCommit.tree.sha, treeEntries);
  const commit = await createCommit(commitMessage, tree.sha, latestRef.object.sha);
  await updateBranchRef(commit.sha);

  for (const record of modifiedRecords) {
    await putFileRecord({
      ...record,
      sha: changedBlobShas.get(record.cacheKey) || record.sha,
      baseText: record.text,
      modified: false,
      updatedAt: new Date().toISOString(),
    });
  }

  if (proofreadChanged) {
    state.proofreadBaseStatus = JSON.parse(JSON.stringify(state.proofreadStatus));
    await putMeta("proofreadBaseStatus", state.proofreadBaseStatus);
  }

  state.bootstrap = {
    ...(state.bootstrap || {}),
    owner: state.repoConfig.owner,
    repo: state.repoConfig.repo,
    branch: state.repoConfig.branch,
    commitSha: commit.sha,
    treeSha: tree.sha,
    updatedAt: new Date().toISOString(),
  };
  await putMeta("bootstrap", state.bootstrap);
  await refreshSummary(true);
  return {
    commitCreated: true,
    commitSha: commit.sha,
    message: commitMessage,
    changedFiles: treeEntries.map((entry) => entry.path),
  };
}

function bindEvents() {
  elements.toggleSidebarBtn.addEventListener("click", toggleSidebar);
  elements.reopenSidebarBtn.addEventListener("click", toggleSidebar);
  elements.progressCloseBtn.addEventListener("click", closeProgressModal);
  elements.configBtn.addEventListener("click", openConfigModal);
  elements.configCloseBtn.addEventListener("click", closeConfigModal);

  elements.fileSearch.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      await applyContentSearch();
    }
  });
  elements.fileSearch.addEventListener("input", async () => {
    if (!elements.fileSearch.value.trim()) {
      state.appliedSearchKeyword = "";
      await refreshContentSearch();
      renderFileList();
      elements.fileList.scrollTop = 0;
    }
  });

  elements.proofreadFilter.addEventListener("change", () => {
    renderFileList();
    elements.fileList.scrollTop = 0;
  });

  elements.refreshBtn.addEventListener("click", async () => {
    const summary = await refreshSummary(true);
    if (state.currentName) {
      await loadScenario(state.currentName);
    } else if (summary.files[0]) {
      await loadScenario(summary.files[0].name);
    } else {
      await renderScenario();
    }
    showToast("已重新整理本機快取畫面", "success");
  });

  elements.syncRemoteBtn.addEventListener("click", async () => {
    openProgressModal({
      title: "同步雲端",
      message: "準備下載最新 GitHub 內容…",
      busy: true,
      closable: false,
    });
    try {
      await syncRemoteWithOverlay();
      await refreshSummary(false);
      if (state.currentName) {
        await loadScenario(state.currentName);
      }
      setProgressState({
        title: "同步完成",
        message: "已更新遠端內容，並保留本機未推送修改。",
        busy: false,
        closable: true,
      });
    } catch (error) {
      setProgressState({
        title: "同步失敗",
        message: error.message,
        busy: false,
        closable: true,
      });
    }
  });

  elements.pushBtn.addEventListener("click", async () => {
    openProgressModal({
      title: "推送 GitHub",
      message: "準備建立 commit…",
      busy: true,
      closable: false,
    });
    try {
      const result = await pushChanges();
      setProgressState({
        title: result.commitCreated ? "推送完成" : "沒有可推送內容",
        message: result.commitCreated ? `已建立 commit ${result.commitSha.slice(0, 7)}` : result.message,
        log: result.changedFiles?.join("\n") || "",
        busy: false,
        closable: true,
      });
    } catch (error) {
      setProgressState({
        title: "推送失敗",
        message: error.message,
        busy: false,
        closable: true,
      });
    }
  });

  elements.replacePreviewBtn.addEventListener("click", previewReplace);
  elements.replaceRunBtn.addEventListener("click", runReplace);
  elements.markDoneBtn.addEventListener("click", () => setReviewStage("done"));
  elements.markTodoBtn.addEventListener("click", () => setReviewStage("todo"));

  const markWipBtn = document.getElementById("markWipBtn");
  if (markWipBtn) {
    markWipBtn.addEventListener("click", () => setReviewStage("wip"));
  }

  elements.configForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.repoConfig = {
      ...state.repoConfig,
      owner: elements.configOwner.value.trim() || DEFAULT_REPO_CONFIG.owner,
      repo: elements.configRepo.value.trim() || DEFAULT_REPO_CONFIG.repo,
      branch: elements.configBranch.value.trim() || DEFAULT_REPO_CONFIG.branch,
      token: elements.configToken.value.trim(),
    };
    saveRepoConfig();
    updateRepoSummary();
    elements.configStatus.textContent = "設定已儲存。";
    closeConfigModal();
    state.bootstrap = null;
    await putMeta("bootstrap", null);
    showToast("GitHub 設定已更新", "success");
  }, { capture: true });
}

async function init() {
  state.sidebarCollapsed = localStorage.getItem(STORAGE_KEYS.sidebarCollapsed) === "1";
  applySidebarState();
  updateRepoSummary();
  bindEvents();
  updateStartupBar({
    message: "準備啟動校對工具",
    detail: "檢查本機快取與 GitHub 設定…",
    current: 0,
    total: 0,
    busy: true,
  });
  await ensureCacheReady(false);
  const summary = await refreshSummary(false);
  if (summary.files[0]) {
    await loadScenario(summary.files[0].name);
  } else {
    await renderScenario();
  }
}

init().catch((error) => {
  updateStartupBar({
    message: "初始化失敗",
    detail: error.message,
    current: 0,
    total: 0,
    busy: false,
  });
  showToast(error.message, "error");
});
