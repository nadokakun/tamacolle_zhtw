const state = {
  files: [],
  filteredFiles: [],
  currentName: "",
  currentScenario: null,
  savingLine: new Set(),
  sidebarCollapsed: false,
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
  jpPane: document.getElementById("jpPane"),
  zhPane: document.getElementById("zhPane"),
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
  elements.toggleSidebarBtn.textContent = state.sidebarCollapsed ? "展開" : "收起";
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
    empty.textContent = "找不到符合條件的檔案。";
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

function syncRowPairHeight(jpRow, zhRow) {
  if (!jpRow || !zhRow) {
    return;
  }

  jpRow.style.minHeight = "";
  zhRow.style.minHeight = "";
  const height = Math.max(jpRow.offsetHeight, zhRow.offsetHeight);
  jpRow.style.minHeight = `${height}px`;
  zhRow.style.minHeight = `${height}px`;
}

function syncRenderedRowHeights() {
  const jpRows = Array.from(elements.jpPane.querySelectorAll(".line-row"));
  const zhRows = Array.from(elements.zhPane.querySelectorAll(".line-row"));
  const count = Math.min(jpRows.length, zhRows.length);

  for (let index = 0; index < count; index += 1) {
    syncRowPairHeight(jpRows[index], zhRows[index]);
  }
}

function markCurrentFileModified() {
  const current = state.files.find((file) => file.name === state.currentName);
  if (!current || current.modified) {
    return;
  }

  current.modified = true;
  const modifiedCount = state.files.filter((file) => file.modified).length;
  elements.modifiedCount.textContent = String(modifiedCount);
  renderFileList();
}

function renderScenario() {
  const scenario = state.currentScenario;
  if (!scenario) {
    elements.currentFile.textContent = "尚未選擇檔案";
    elements.currentMeta.textContent = "";
    elements.jpPane.innerHTML = '<div class="empty">請先從左側選擇檔案。</div>';
    elements.zhPane.innerHTML = '<div class="empty">請先從左側選擇檔案。</div>';
    return;
  }

  elements.currentFile.textContent = scenario.name;
  elements.currentMeta.textContent = `日文 ${scenario.jp.length} 行 | 中文 ${scenario.zh.length} 行`;
  elements.jpPane.innerHTML = "";
  elements.zhPane.innerHTML = "";

  const jpList = document.createElement("div");
  const zhList = document.createElement("div");
  jpList.className = "line-list";
  zhList.className = "line-list";

  const maxLines = Math.max(scenario.jp.length, scenario.zh.length);

  for (let index = 0; index < maxLines; index += 1) {
    const lineNo = index + 1;
    const jpLine = scenario.jp[index] ?? "";
    const zhLine = scenario.zh[index] ?? "";

    const jpRow = document.createElement("div");
    jpRow.className = "line-row";
    jpRow.innerHTML = `
      <span class="line-no">${lineNo}</span>
      <div class="line-text">${escapeHtml(jpLine)}</div>
    `;
    jpList.appendChild(jpRow);

    const zhRow = document.createElement("div");
    zhRow.className = "line-row";

    const no = document.createElement("span");
    no.className = "line-no";
    no.textContent = String(lineNo);

    const input = document.createElement("textarea");
    input.className = "line-input";
    input.rows = 1;
    input.value = zhLine;
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
      requestAnimationFrame(() => syncRowPairHeight(jpRow, zhRow));
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

    const wrapper = document.createElement("div");
    wrapper.className = "line-input-wrap";
    wrapper.append(input, saveState);

    zhRow.append(no, wrapper);
    zhList.appendChild(zhRow);
  }

  elements.jpPane.appendChild(jpList);
  elements.zhPane.appendChild(zhList);
  requestAnimationFrame(syncRenderedRowHeights);
}

function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(textarea.scrollHeight, 34)}px`;
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
    requestAnimationFrame(() => {
      const lineIndex = lineNo - 1;
      const jpRow = elements.jpPane.querySelectorAll(".line-row")[lineIndex];
      const zhRow = elements.zhPane.querySelectorAll(".line-row")[lineIndex];
      syncRowPairHeight(jpRow, zhRow);
    });
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
  state.currentScenario = await api(`/api/file?name=${encodeURIComponent(name)}`);
  renderScenario();
}

async function setProofread(done) {
  if (!state.currentName) {
    return;
  }
  await api("/api/proofread", {
    method: "POST",
    body: JSON.stringify({ name: state.currentName, done }),
  });
  showToast(done ? "已標記為校對完成" : "已取消校對完成", "success");
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

  elements.replaceStatus.textContent = `預計修改 ${result.filesMatched} 個檔案，共 ${result.matchCount} 處。`;
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

  elements.replaceStatus.textContent = `已修改 ${result.filesUpdated} 個檔案，共 ${result.matchCount} 處。備份: ${result.backupDir || "無"}`;
  showToast("快速取代已完成", "success");
  await refreshSummary(true);
  if (state.currentName) {
    await loadScenario(state.currentName);
  }
}

async function syncRemote() {
  openProgressModal({
    title: "同步雲端中",
    message: "正在從 GitHub 拉取最新內容，請稍候...",
    busy: true,
    closable: false,
  });

  try {
    const result = await api("/api/sync-remote", { method: "POST", body: "{}" });
    setProgressState({
      title: "同步完成",
      message: "已完成雲端同步。",
      log: [result.stdout, result.stderr].filter(Boolean).join("\n\n"),
      busy: false,
      closable: true,
    });
    showToast(result.stdout || "已完成同步", "success");
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
    message: "正在整理變更、提交並推送到 GitHub，請稍候...",
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
      message: result.commitCreated ? "已提交並推送到 GitHub。" : "沒有新變更，但已完成推送檢查。",
      log: logParts.join("\n\n"),
      busy: false,
      closable: true,
    });
    showToast(result.commitCreated ? "已提交並推送到 GitHub" : "沒有新變更，但已嘗試推送", "success");
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
  const summary = await refreshSummary(false);
  if (summary.files[0]) {
    await loadScenario(summary.files[0].name);
  } else {
    renderScenario();
  }
}

init().catch((error) => {
  showToast(error.message, "error");
});
