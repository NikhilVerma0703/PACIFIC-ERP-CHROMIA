@echo off
setlocal
echo ============================================
echo   Pacific ERP - cloud DB setup (no Docker)
echo ============================================
echo.
echo Make sure .env.local has DATABASE_URL set to your Neon connection string.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed. Get it from https://nodejs.org
  pause & exit /b 1
)

findstr /C:"neon.tech" .env.local >nul 2>nul
if errorlevel 1 (
  echo [WARN] .env.local does not appear to contain a Neon URL.
  echo        Open .env.local and set DATABASE_URL to your Neon string first.
  echo.
)

echo [1/4] Installing dependencies...
call npm install || (echo npm install failed & pause & exit /b 1)

echo.
echo [2/4] Creating database tables on Neon...
call npm run db:push || (echo db:push failed - check DATABASE_URL & pause & exit /b 1)

echo.
echo [3/4] Creating the admin user...
call npm run db:seed || (echo db:seed failed & pause & exit /b 1)

echo.
echo [4/4] Done. Start the app with:  npm run dev
echo   Open http://localhost:3000  (login: admin@thepacific.group / changeme)
echo.
pause
