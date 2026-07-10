@echo off
setlocal
echo ============================================
echo   Pacific ERP - first-time setup
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed. Get it from https://nodejs.org
  pause & exit /b 1
)

where docker >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Docker is not installed. Get Docker Desktop from
  echo         https://www.docker.com/products/docker-desktop
  pause & exit /b 1
)

if not exist ".env.local" (
  echo Creating .env.local from template...
  copy ".env.example" ".env.local" >nul
  echo   ^>^> Edit .env.local to set a real AUTH_SECRET and admin password.
)

echo.
echo [1/5] Installing dependencies (this can take a minute)...
call npm install || (echo npm install failed & pause & exit /b 1)

echo.
echo [2/5] Starting local Postgres (Docker)...
call docker compose up -d || (echo docker compose failed - is Docker Desktop running? & pause & exit /b 1)

echo.
echo [3/5] Waiting for the database to be ready...
timeout /t 6 /nobreak >nul

echo.
echo [4/5] Creating database tables...
call npm run db:push || (echo db:push failed & pause & exit /b 1)

echo.
echo [5/5] Creating the admin user...
call npm run db:seed || (echo db:seed failed & pause & exit /b 1)

echo.
echo ============================================
echo   Setup complete!
echo   Run:  npm run dev
echo   Open: http://localhost:3000
echo   Login with the email/password from .env.local
echo ============================================
echo.
pause
