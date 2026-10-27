@echo off
setlocal
cd /d "%~dp0"

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo npm.cmd was not found. Install Node.js for Windows and try again.
  exit /b 1
)

if exist "node_modules\@task-keeper\client" (
  rmdir "node_modules\@task-keeper\client" 2>nul
  if exist "node_modules\@task-keeper\client" goto :link_error
)
if exist "node_modules\@task-keeper\server" (
  rmdir "node_modules\@task-keeper\server" 2>nul
  if exist "node_modules\@task-keeper\server" goto :link_error
)

call npm.cmd ci
if errorlevel 1 goto :install_error

echo.
echo Windows dependencies are ready. Start the app with: npm.cmd run dev
exit /b 0

:link_error
echo Could not remove the WSL workspace links.
echo Stop the task_keeper dev server in WSL, then run this script again.
echo Do not run the Windows and WSL installs against the same node_modules at once.
exit /b 1

:install_error
echo npm ci failed. Stop any task_keeper processes using node_modules and retry.
exit /b 1
