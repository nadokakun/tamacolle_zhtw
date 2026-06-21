@echo off
setlocal

set "PYTHON_EXE=C:\Users\Nadoka\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
set "BUILD_SCRIPT=C:\Users\Nadoka\Documents\Codex\2026-06-21\files-mentioned-by-the-user-conversation\work\build_tamacolle_translation_pack.py"
set "RAW_DIR=C:\Users\Nadoka\Documents\Codex\2026-06-21\files-mentioned-by-the-user-conversation\outputs\tamacolle_github_public_repo\zh_tw\raw"
set "OUT_DIR=C:\Users\Nadoka\Documents\Codex\2026-06-21\files-mentioned-by-the-user-conversation\outputs\tamacolle_github_public_repo\userscript"

set /p GITHUB_USER=GitHub 帳號：
set /p GITHUB_REPO=Repo 名稱：

if "%GITHUB_USER%"=="" goto :missing
if "%GITHUB_REPO%"=="" goto :missing

set "BASE_URL=https://%GITHUB_USER%.github.io/%GITHUB_REPO%/zh_tw/raw/"

echo.
echo 正在生成 GitHub Pages 版 userscript...
echo Base URL: %BASE_URL%
echo.

"%PYTHON_EXE%" "%BUILD_SCRIPT%" --raw "%RAW_DIR%" --out "%OUT_DIR%" --base-url "%BASE_URL%"

echo.
echo 完成：
echo %OUT_DIR%\tamacolle_scenario_zh_tw_mount.user.js
goto :end

:missing
echo 必須輸入 GitHub 帳號與 repo 名稱。

:end
endlocal
