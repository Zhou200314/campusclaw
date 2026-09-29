@echo off
rem 双击即可一键生成作业截图（需要先执行过一次 npm install）
cd /d "%~dp0\.."
node scripts\capture-screenshots.mjs
pause
