# Tamacolle ZH-TW Repo

這個 repo 目前包含三個主要用途：

- `zh_tw/raw/`：中文翻譯原始檔
- `ja_noruby/raw/`：去除 ruby 標記後的日文原文
- `review/`：可放在 GitHub Pages 的翻譯校對工具

## 目錄

```txt
repo-root/
├─ .nojekyll
├─ README.md
├─ build_userscript_for_github_pages.cmd
├─ ja_noruby/
│  └─ raw/
├─ review/
│  ├─ app.js
│  ├─ index.html
│  ├─ proofread-status.json
│  ├─ server.mjs
│  └─ start-review.ps1
├─ userscript/
└─ zh_tw/
   └─ raw/
```

## 線上校對工具

校對工具入口：

- `review/index.html`

如果這個 repo 已啟用 GitHub Pages，工具網址會是：

```txt
https://nadokakun.github.io/tamacolle_zhtw/review/
```

這個版本已改成「前端直接讀寫 GitHub」：

- 首次開啟會把中日文檔案下載到瀏覽器本機快取
- 右側可以直接編輯翻譯，按 `Enter` 儲存到本機快取
- 可搜尋中文內容、快速取代、標記校對完成
- 可從 GitHub 重新同步
- 可直接把修改推送回 repo

## GitHub Pages 使用方式

### 1. 啟用 Pages

在 GitHub repo 的 `Settings -> Pages`：

1. Source 選擇目前 repo 的 branch
2. 資料夾選擇 `/ (root)`
3. 儲存後等待 GitHub 發佈

完成後即可透過：

```txt
https://<owner>.github.io/<repo>/review/
```

開啟校對工具。

### 2. 首次使用

首次打開工具時會：

1. 從 GitHub 讀取檔案樹
2. 下載 `ja_noruby/raw` 與 `zh_tw/raw` 的 scenario 檔
3. 建立瀏覽器本機快取

之後再次開啟會優先使用本機快取，因此速度會快很多。

### 3. 推送修改

因為 GitHub Pages 只能託管靜態頁面，無法在伺服器端執行 `git push`，所以推送採用 GitHub API。

請在工具右上角的 `GitHub 設定` 填入：

- `Owner`
- `Repository`
- `Branch`
- `Personal Access Token`

建議使用 Fine-grained PAT，至少提供目標 repo 的：

- `Contents: Read and write`

權杖只會存到你目前瀏覽器的 local storage，不會寫進 repo。

## 校對狀態

校對完成狀態儲存在：

- `review/proofread-status.json`

當你在工具內標記「已校對」後，狀態會先存在瀏覽器本機快取；按下 `推送 GitHub` 後，才會一併提交到 repo。

## 本機啟動版

repo 仍保留舊的本機 Node.js 啟動方式：

- `review/start-review.ps1`
- `review/server.mjs`

但現在主要建議使用 GitHub Pages 版本，這樣在其他電腦上只要打開網址即可使用。
