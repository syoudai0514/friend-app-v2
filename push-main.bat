@echo off
setlocal

rem friend-app-v2: GitHub の main ブランチへ push するバッチ
cd /d "%~dp0"

for /f "delims=" %%B in ('git branch --show-current 2^>nul') do set "CURRENT_BRANCH=%%B"
if not "%CURRENT_BRANCH%"=="main" (
  echo [中止] 現在のブランチは "%CURRENT_BRANCH%" です。main で実行してください。
  pause
  exit /b 1
)

echo 対象フォルダ: %CD%
echo ブランチ: %CURRENT_BRANCH%
echo.
echo GitHub の認証が表示された場合は、画面の案内に従って完了してください。
echo.

git push origin main
if errorlevel 1 (
  echo.
  echo [失敗] pushできませんでした。認証またはGitHub Desktopの接続を確認してください。
  pause
  exit /b 1
)

echo.
echo [完了] origin/main へ push しました。
pause
