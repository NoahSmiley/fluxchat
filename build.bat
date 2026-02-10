@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=amd64 > nul 2>&1
cd /d C:\Users\noah\benchmarks\flux-tauri
set PATH=C:\Users\noah\.cargo\bin;%PATH%
echo Starting build...
cargo build -p flux-shared -p flux-server > C:\Users\noah\build_output.txt 2>&1
echo Exit code: %ERRORLEVEL% >> C:\Users\noah\build_output.txt
