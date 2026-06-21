const state = {
  files: [],
  filteredFiles: [],
  currentName: "",
  currentScenario: null,
  savingLine: new Set(),
  sidebarCollapsed: false,
  renderToken: 0,
  startupPollTimer: null,
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
  toast: document.getElementById("toast"),
  progressModal: document.getElementById("progressModal"),
  progressTitle: document.getElementById("progressTitle"),
  progressMessage: document.getElementById("progressMessage"),
  progressLog: document.getElementById("progressLog"),
  progressSpinner: document.getElementById("progressSpinner"),
  progressCloseBtn: document.getElementById("progressCloseBtn"),
};

function applySidebarState() {
  elements.main.classList.toggle("is-sidebar-collapsed", state.sidebarCollapsed);
  elements.sidebarPanel.classList.toggle("is-collapsed", state.sidebarCollapsed);
  elements.toggleSidebarBtn.textContent = state.sidebarCollapsed ? "展開" : "收合";
  elements.toggleSidebarBtn.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
  elements.reopenSidebarBtn.classList.toggle("is-visible", state.sidebarCollapsed);
  elements.reopenSidebarBtn.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  localStorage.setItem("tamacolle-review-sidebar-collapsed", state.sidebarCollapsed ? "1" : "0");
  applySidebarState();
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

function setProgressState({
  title,
  message,
  log = "",
  closable = false,
  busy = true,
}) {
  elements.progressTitle.textContent = title;
  elements.progressMessage.textContent = message;
  elements.progressSpinner.hidden = !busy;
  elements.progressCloseBtn.hidden = !closable;

  if (log) {
    elements.progressLog.hidden = false;
    elements.progressLog.textContent = log;
  } else {
    elements.progressLog.hidden = true;
    elements.progressLog.textContent = "";
  }
}

function openProgressModal(config) {
  setProgressState(config);
  elements.progressModal.hidden = false;
}

function closeProgressModal() {
  elements.progressModal.hidden = true;
}

function updateStartupBar(status) {
  const progressText = status.total > 0 ? `${status.current}/${status.total}` : "";
  elements.startupStatusText.textContent = status.message || "初始化中";
  elements.startupStatusDetail.textContent = status.detail || "";
  elements.startupStatusProgress.textContent = progressText;
  elements.startupStatusBar.dataset.phase = status.phase || "idle";
  elements.startupStatusBar.classList.toggle("is-busy", Boolean(status.busy));
  elements.startupStatusBar.classList.toggle("is-ready", !status.busy);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function filteredFiles() {
  const keyword = elements.fileSearch.value.trim().toLowerCase();
  const filter = elements.proofreadFilter.value;

  state.filteredFiles = state.files.filter((file) => {
    const matchesKeyword = !keyword || file.name.toLowerCase().includes(keyword);
    const matchesFilter =
      filter === "all" ||
      (filter === "done" && file.proofread) ||
      (filter === "todo" && !file.proofread) ||
      (filter === "modified" && file.modified);

    return matchesKeyword && matchesFilter;
  });
}

function renderFileList() {
  filteredFiles();
  elements.fileList.innerHTML = "";

  if (state.filteredFiles.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "沒有符合條件的檔案。";
    elements.fileList.appendChild(empty);
    return;
  }

  for (const file of state.filteredFiles) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `file-item${file.name === state.currentName ? " is-active" : ""}`;
    button.dataset.name = file.name;

    const status = file.proofread ? "已校對" : "未校對";
    button.innerHTML = `
      <strong>${escapeHtml(file.name)}</strong>
      <span>${file.jpLines} / ${file.zhLines} 行</span>
      <span class="pill ${file.proofread ? "is-done" : "is-todo"}">${status}</span>
      ${file.modified ? '<span class="pill is-modified">已修改</span>' : ""}
    `;

    button.addEventListener("click", () => loadScenario(file.name));
    elements.fileList.appendChild(button);
  }
}

function updateMeta(summary) {
  elements.fileCount.textContent = String(summary.fileCount);
  elements.proofreadCount.textContent = String(summary.proofreadCount);
  elements.modifiedCount.textContent = String(summary.modifiedCount);
}

function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(textarea.scrollHeight, 42)}px`;
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
  autoGrow(input);

  const saveState = document.createElement("span");
  saveState.className = "save-state";
  saveState.textContent = "已儲存";
  saveState.dataset.state = "saved";

  input.addEventListener("input", () => {
    saveState.textContent = "未儲存";
    saveState.dataset.pending = "true";
    saveState.dataset.state = "pending";
    autoGrow(input);
  });

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

function markCurrentFileModified() {
  const current = state.files.find((file) => file.name === state.currentName);
  if (!current || current.modified) {
    return;
  }

  current.modified = true;
  elements.modifiedCount.textContent = String(state.files.filter((file) => file.modified).length);
  renderFileList();
}

async function renderScenario() {
  const scenario = state.currentScenario;
  const renderToken = ++state.renderToken;

  if (!scenario) {
    elements.currentFile.textContent = "尚未選擇檔案";
    elements.currentMeta.textContent = "";
    elements.comparePane.innerHTML = '<div class="empty">請先從左側選擇要校對的檔案。</div>';
    return;
  }

  elements.currentFile.textContent = scenario.name;
  const maxLines = Math.max(scenario.jp.length, scenario.zh.length);
  elements.currentMeta.textContent = `日文 ${scenario.jp.length} 行 | 中文 ${scenario.zh.length} 行`;
  elements.comparePane.innerHTML = '<div class="empty">載入對照內容中...</div>';

  const list = document.createElement("div");
  list.className = "compare-list";
  elements.comparePane.innerHTML = "";
  elements.comparePane.appendChild(list);

  const batchSize = maxLines > 12000 ? 120 : 240;

  for (let start = 0; start < maxLines; start += batchSize) {
    if (renderToken !== state.renderToken) {
      return;
    }

    const fragment = document.createDocumentFragment();
    const end = Math.min(start + batchSize, maxLines);
    for (let index = start; index < end; index += 1) {
      fragment.appendChild(
        createCompareRow(index + 1, scenario.jp[index] ?? "", scenario.zh[index] ?? ""),
      );
    }

    list.appendChild(fragment);
    elements.currentMeta.textContent =
      `日文 ${scenario.jp.length} 行 | 中文 ${scenario.zh.length} 行 | 載入 ${end}/${maxLines}`;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  if (renderToken !== state.renderToken) {
    return;
  }

  elements.currentMeta.textContent = `日文 ${scenario.jp.length} 行 | 中文 ${scenario.zh.length} 行`;
}

async function saveLine(lineNo, input, saveState) {
  const key = `${state.currentName}:${lineNo}`;
  if (state.savingLine.has(key)) {
    return;
  }

  state.savingLine.add(key);
  saveState.textContent = "儲存中...";
  saveState.dataset.state = "saving";

  try {
    await api("/api/save-line", {
      method: "POST",
      body: JSON.stringify({
        name: state.currentName,
        lineNumber: lineNo,
        text: input.value,
      }),
    });

    state.currentScenario.zh[lineNo - 1] = input.value;
    saveState.textContent = "已儲存";
    delete saveState.dataset.pending;
    saveState.dataset.state = "saved";
    markCurrentFileModified();
    showToast(`第 ${lineNo} 行已儲存`, "success");
  } catch (error) {
    saveState.textContent = "儲存失敗";
    saveState.dataset.state = "error";
    showToast(error.message, "error");
  } finally {
    state.savingLine.delete(key);
  }
}

async function refreshSummary(keepSelection = true) {
  const summary = await api("/api/files");
  state.files = summary.files;
  updateMeta(summary);
  renderFileList();

  if (!keepSelection || !state.currentName) {
    return summary;
  }

  const stillExists = state.files.some((file) => file.name === state.currentName);
  if (!stillExists && state.files[0]) {
    await loadScenario(state.files[0].name);
  }

  return summary;
}

async function loadScenario(name) {
  state.currentName = name;
  renderFileList();
  elements.currentFile.textContent = `${name} 載入中...`;
  elements.currentMeta.textContent = "讀取檔案中...";
  state.currentScenario = await api(`/api/file?name=${encodeURIComponent(name)}`);
  await renderScenario();
}

async function setProofread(done) {
  if (!state.currentName) {
    return;
  }

  await api("/api/proofread", {
    method: "POST",
    body: JSON.stringify({ name: state.currentName, done }),
  });

  showToast(done ? "已標記為校對完成" : "已取消校對完成標記", "success");
  await refreshSummary(true);
  renderFileList();
}

async function previewReplace() {
  const result = await api("/api/replace-preview", {
    method: "POST",
    body: JSON.stringify({
      findText: elements.replaceFind.value,
      replaceText: elements.replaceTo.value,
      scope: elements.replaceScope.value,
      currentFile: state.currentName,
      caseSensitive: elements.caseSensitive.checked,
      useRegex: elements.useRegex.checked,
    }),
  });

  elements.replaceStatus.textContent = `預覽找到 ${result.filesMatched} 個檔案，共 ${result.matchCount} 筆符合。`;
}

async function runReplace() {
  const result = await api("/api/replace-all", {
    method: "POST",
    body: JSON.stringify({
      findText: elements.replaceFind.value,
      replaceText: elements.replaceTo.value,
      scope: elements.replaceScope.value,
      currentFile: state.currentName,
      caseSensitive: elements.caseSensitive.checked,
      useRegex: elements.useRegex.checked,
    }),
  });

  elements.replaceStatus.textContent =
    `已更新 ${result.filesUpdated} 個檔案，共 ${result.matchCount} 筆，備份位置 ${result.backupDir || "-"}`;
  showToast("快速取代已完成", "success");
  await refreshSummary(true);
  if (state.currentName) {
    await loadScenario(state.currentName);
  }
}

async function syncRemote() {
  openProgressModal({
    title: "同步雲端中",
    message: "正在從 GitHub 下載最新內容並更新本地快照...",
    busy: true,
    closable: false,
  });

  try {
    const result = await api("/api/sync-remote", { method: "POST", body: "{}" });
    setProgressState({
      title: "同步完成",
      message: "本地內容已更新完成。",
      log: [result.stdout, result.stderr].filter(Boolean).join("\n\n"),
      busy: false,
      closable: true,
    });
    showToast(result.stdout || "同步完成", "success");
    await refreshSummary(true);
    if (state.currentName) {
      await loadScenario(state.currentName);
    }
  } catch (error) {
    setProgressState({
      title: "同步失敗",
      message: error.message,
      busy: false,
      closable: true,
    });
    showToast(error.message, "error");
  }
}

async function pushChanges() {
  openProgressModal({
    title: "推送 GitHub 中",
    message: "正在整理變更、建立提交並推送到 GitHub...",
    busy: true,
    closable: false,
  });

  try {
    const result = await api("/api/git-push", {
      method: "POST",
      body: JSON.stringify({ message: elements.commitMessage.value }),
    });
    const logParts = [];
    if (result.message) {
      logParts.push(`提交訊息: ${result.message}`);
    }
    if (result.stdout) {
      logParts.push(result.stdout);
    }
    if (result.stderr) {
      logParts.push(result.stderr);
    }

    setProgressState({
      title: "推送完成",
      message: result.commitCreated ? "已建立提交並推送到 GitHub。" : "沒有新的檔案變更，但已完成同步與推送。",
      log: logParts.join("\n\n"),
      busy: false,
      closable: true,
    });
    showToast(result.commitCreated ? "已推送到 GitHub" : "沒有新變更可推送", "success");
    await refreshSummary(true);
  } catch (error) {
    setProgressState({
      title: "推送失敗",
      message: error.message,
      busy: false,
      closable: true,
    });
    showToast(error.message, "error");
  }
}

async function waitForStartupReady() {
  while (true) {
    const status = await api("/api/startup-status");
    updateStartupBar(status);
    if (!status.busy) {
      return status;
    }
    await new Promise((resolve) => {
      state.startupPollTimer = setTimeout(resolve, 350);
    });
  }
}

function bindEvents() {
  elements.toggleSidebarBtn.addEventListener("click", toggleSidebar);
  elements.reopenSidebarBtn.addEventListener("click", toggleSidebar);
  elements.progressCloseBtn.addEventListener("click", closeProgressModal);
  elements.fileSearch.addEventListener("input", renderFileList);
  elements.proofreadFilter.addEventListener("change", renderFileList);
  elements.refreshBtn.addEventListener("click", async () => {
    await refreshSummary(true);
    if (state.currentName) {
      await loadScenario(state.currentName);
    }
  });
  elements.syncRemoteBtn.addEventListener("click", syncRemote);
  elements.pushBtn.addEventListener("click", pushChanges);
  elements.replacePreviewBtn.addEventListener("click", previewReplace);
  elements.replaceRunBtn.addEventListener("click", runReplace);
  document.getElementById("markDoneBtn").addEventListener("click", () => setProofread(true));
  document.getElementById("markTodoBtn").addEventListener("click", () => setProofread(false));
}

async function init() {
  state.sidebarCollapsed = localStorage.getItem("tamacolle-review-sidebar-collapsed") === "1";
  applySidebarState();
  bindEvents();
  updateStartupBar({
    phase: "boot",
    message: "正在連線到校對服務",
    detail: "準備讀取初始化狀態...",
    current: 0,
    total: 0,
    busy: true,
  });
  await waitForStartupReady();
  const summary = await refreshSummary(false);
  if (summary.files[0]) {
    await loadScenario(summary.files[0].name);
  } else {
    await renderScenario();
  }
}

init().catch((error) => {
  showToast(error.message, "error");
  updateStartupBar({
    phase: "error",
    message: "初始化失敗",
    detail: error.message,
    current: 0,
    total: 0,
    busy: false,
  });
});
