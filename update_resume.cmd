@echo off
rem Lets "update_resume file.pdf" work from cmd, and ".\update_resume file.pdf"
rem from PowerShell, by running the bash script with Git Bash, or with WSL if
rem Git Bash isn't installed.
setlocal
set "SCRIPT=%~dp0update_resume"
set "BASH="

for %%B in ("%ProgramFiles%\Git\bin\bash.exe" "%ProgramFiles(x86)%\Git\bin\bash.exe" "%LocalAppData%\Programs\Git\bin\bash.exe") do (
  if not defined BASH if exist %%B set "BASH=%%~B"
)
if not defined BASH for /f "delims=" %%G in ('where git.exe 2^>nul') do (
  if not defined BASH if exist "%%~dpG..\bin\bash.exe" set "BASH=%%~dpG..\bin\bash.exe"
)
if defined BASH goto gitbash

where wsl.exe >nul 2>nul
if not errorlevel 1 goto wsl

echo update_resume needs bash. Install Git for Windows (winget install Git.Git,
echo or https://git-scm.com/download/win), then run this again.
exit /b 1

:gitbash
"%BASH%" "%SCRIPT:\=/%" %*
exit /b %ERRORLEVEL%

:wsl
rem WSL starts in the current folder, so run from the repo (PDF paths relative
rem to it, or full C:\ paths, both work).
pushd "%~dp0"
wsl.exe bash ./update_resume %*
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
