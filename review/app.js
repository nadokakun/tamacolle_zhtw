const state = {
  files: [],
  filteredFiles: [],
  currentName: "",
  currentScenario: null,
  syncScroll: true,
  savingLine: new Set(),
};

const elements = {
  fileSearch: document.getElementById("fileSearch"),
  proofreadFilter: document.getElementById("proofreadFilter"),
  fileList: document.getElementById("fileList"),
  fileCount: document.getElementById("fileCount"),
  proofreadCount: document.getElementById("proofreadCount"),
  modifiedCount: document.getElementById("modifiedCount"),
  currentFile: document.getElementById("currentFile"),
  currentMeta: document.getElementById("currentMeta"),
  syncToggle: document.getElementById("syncToggle"),
  refreshBtn: document.getElementById("refreshBtn"),
  syncRemoteBtn: document.getElementById("syncRemoteBtn"),
  pushBtn: document.getElementById("pushBtn"),
  commitMessage: document.getElementById("commitMessage"),
  gitSummary: document.getElementById("gitSummary"),
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
};

function showToast(message, type = "info") {
  elements.toast.textContent = message;
  elements.toast.dataset.type = type;
  elements.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 2600);
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
  elements.gitSummary.textContent = `分支 ${summary.git.branch} | ${summary.git.dirty ? "有未提交修改" : "工作樹乾淨"}`;
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

    input.addEventListener("input", () => {
      saveState.textContent = "未儲存";
      saveState.dataset.pending = "true";
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

    const wrapper = document.createElement("div");
    wrapper.className = "line-input-wrap";
    wrapper.append(input, saveState);

    zhRow.append(no, wrapper);
    zhList.appendChild(zhRow);
  }

  elements.jpPane.appendChild(jpList);
  elements.zhPane.appendChild(zhList);
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
    showToast(`第 ${lineNo} 行已儲存`, "success");
    await refreshSummary(false);
  } catch (error) {
    saveState.textContent = "儲存失敗";
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
  const result = await api("/api/sync-remote", { method: "POST", body: "{}" });
  showToast(result.stdout || "已完成同步", "success");
  await refreshSummary(true);
  if (state.currentName) {
    await loadScenario(state.currentName);
  }
}

async function pushChanges() {
  const result = await api("/api/git-push", {
    method: "POST",
    body: JSON.stringify({ message: elements.commitMessage.value }),
  });
  showToast(result.commitCreated ? "已提交並推送到 GitHub" : "沒有新變更，但已嘗試推送", "success");
  await refreshSummary(true);
}

function wireScrollSync() {
  let locked = false;
  const sync = (source, target) => {
    if (!state.syncScroll || locked) {
      return;
    }
    locked = true;
    const maxSource = Math.max(source.scrollHeight - source.clientHeight, 1);
    const maxTarget = Math.max(target.scrollHeight - target.clientHeight, 1);
    target.scrollTop = (source.scrollTop / maxSource) * maxTarget;
    requestAnimationFrame(() => {
      locked = false;
    });
  };

  elements.jpPane.addEventListener("scroll", () => sync(elements.jpPane, elements.zhPane));
  elements.zhPane.addEventListener("scroll", () => sync(elements.zhPane, elements.jpPane));
}

function bindEvents() {
  elements.fileSearch.addEventListener("input", renderFileList);
  elements.proofreadFilter.addEventListener("change", renderFileList);
  elements.syncToggle.addEventListener("change", () => {
    state.syncScroll = elements.syncToggle.checked;
  });
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
  bindEvents();
  wireScrollSync();
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
