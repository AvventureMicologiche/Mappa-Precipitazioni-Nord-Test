@echo off
rem Doppio clic dopo aver modificato i file testi-*.txt di questa cartella:
rem rifa' le pagine della mappa forestale (in locale, niente viene pubblicato)
rem e apre nel browser le tre pagine castagneti, querceti, abetaie e peccete.
cd /d "%~dp0..\..\.."
node .github\scripts\genera-mappa-forestale.js
if errorlevel 1 (
  echo.
  echo Qualcosa non va: leggi il messaggio qui sopra.
  pause
  exit /b
)
start "" "%cd%\mappa-forestale\castagneti\index.html"
start "" "%cd%\mappa-forestale\querceti\index.html"
start "" "%cd%\mappa-forestale\abetaie-e-peccete\index.html"
echo.
echo Fatto. Le pagine sono aperte nel browser. Per pubblicarle chiedi a Claude.
timeout /t 6 >nul
