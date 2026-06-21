# Tamacolle 公開 GitHub Repo 發佈包

這份資料夾是給公開 GitHub repository 使用的版本，內容包含：

- 繁體中文翻譯劇本
- 去除 ruby 的日文原稿
- 同步卷軸校對工具
- GitHub Pages 用的 userscript 輸出

## 建議 repo 結構

將整個資料夾內容放到 GitHub repo 根目錄：

```txt
repo-root/
├─ .nojekyll
├─ README.md
├─ build_userscript_for_github_pages.cmd
├─ ja_noruby/
│  └─ raw/
│     └─ scenario_*.txt
├─ review/
│  ├─ index.html
│  └─ review-data.js
├─ userscript/
│  ├─ tamacolle_scenario_zh_tw_manifest.json
│  └─ tamacolle_scenario_zh_tw_mount.user.js
└─ zh_tw/
   └─ raw/
      └─ scenario_*.txt
```

## 各資料夾用途

### `zh_tw/raw/`

繁體中文翻譯完成版。  
油猴腳本會從這裡讀取 `scenario_*.txt`。

### `ja_noruby/raw/`

去除 ruby 標記、只保留正文的日文版。  
適合人工校對與比對翻譯。

### `review/`

校對工具。  

本機啟動入口：

- [review/start-review.ps1](review/start-review.ps1)
- [review/index.html](review/index.html)

啟動後預設開在：

```txt
http://127.0.0.1:8767/
```

若 GitHub Pages 已啟用，也可以放在：

```txt
https://你的帳號.github.io/你的repo/review/
```

### `userscript/`

GitHub Pages 掛載用的 userscript 與 manifest。

## 發佈到 GitHub Pages

GitHub 官方文件：

- [What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Configuring a publishing source for your GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

建議流程：

1. 建立一個公開 repo
2. 把這個資料夾內容推上去
3. 在 GitHub Pages 設定中，將發佈來源設為該 repo 的 branch
4. 啟用後會得到：

```txt
https://你的帳號.github.io/你的repo/
```

## 重新產生 GitHub Pages 版 userscript

因為每個人的 GitHub Pages 網址不同，所以要依自己的 repo 網址重新生成一次 userscript。

直接執行：

[build_userscript_for_github_pages.cmd](C:/Users/Nadoka/Documents/Codex/2026-06-21/files-mentioned-by-the-user-conversation/outputs/tamacolle_github_public_repo/build_userscript_for_github_pages.cmd)

它會請你輸入：

- GitHub 帳號
- repo 名稱

然後自動把 `userscript/tamacolle_scenario_zh_tw_mount.user.js` 重建成對應你自己 Pages 網址的版本。

## GitHub Pages 完成後的路徑

如果帳號是 `example`，repo 是 `tamacolle-translation`，那麼：

### 翻譯劇本

```txt
https://example.github.io/tamacolle-translation/zh_tw/raw/scenario_a001.txt
```

### 去 ruby 日文稿

```txt
https://example.github.io/tamacolle-translation/ja_noruby/raw/scenario_a001.txt
```

### 校對工具

```txt
https://example.github.io/tamacolle-translation/review/
```

## 安裝 userscript

重新生成後，將這份匯入 Tampermonkey：

- `userscript/tamacolle_scenario_zh_tw_mount.user.js`

之後進入 Tamacolle 頁面，就會從 GitHub Pages 讀取翻譯劇本，不需要再開本機伺服器。

## 校對工具快速入口

- 啟動腳本：[review/start-review.ps1](review/start-review.ps1)
- 校對工具目錄：[review/](review/)
- 本機校對網址：`http://127.0.0.1:8767/`

## 注意事項

- repo 必須公開，這樣 GitHub Pages 與外部讀取才會最省事
- 若你改了 GitHub 帳號名、repo 名稱、子路徑，請重新生成 userscript
- 若新增 `scenario_*.txt`，只要更新 `zh_tw/raw/` 後重新 push 到 GitHub 即可
