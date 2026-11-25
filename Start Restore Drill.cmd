@echo off
setlocal
cd /d "%~dp0"
if /i "%~1"=="login" goto login
if /i "%~1"=="doctor" goto doctor
powershell.exe -NoProfile -Command "$c=if(Test-Path '.local-tools.json'){Get-Content -Raw '.local-tools.json'|ConvertFrom-Json};$n=Get-Command node -ErrorAction SilentlyContinue;if($n){$p=$n.Source}else{$p=$c.node};if(!$p){throw 'Install Node.js 24 or newer'};& $p app.mjs;exit $LASTEXITCODE"
goto finish
:login
powershell.exe -NoProfile -Command "$c=if(Test-Path '.local-tools.json'){Get-Content -Raw '.local-tools.json'|ConvertFrom-Json};if($c.kane){& $c.node $c.kane login --oauth}else{& kane-cli login --oauth};exit $LASTEXITCODE"
goto finish
:doctor
powershell.exe -NoProfile -Command "$c=if(Test-Path '.local-tools.json'){Get-Content -Raw '.local-tools.json'|ConvertFrom-Json};$n=Get-Command node -ErrorAction SilentlyContinue;if($n){$p=$n.Source}else{$p=$c.node};if(!$p){throw 'Install Node.js 24 or newer'};& $p cli.mjs doctor;exit $LASTEXITCODE"
:finish
if errorlevel 1 pause
