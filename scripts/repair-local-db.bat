@echo off
setlocal enabledelayedexpansion
REM ---------------------------------------------------------------------------
REM Bring the LOCAL dev database in line with the code.
REM
REM Safe to re-run: every step is idempotent. Run from the repo root:
REM     scripts\repair-local-db.bat
REM
REM Step 2 now STOPS if a script file is missing, instead of printing an error
REM and carrying on as if it had run. That is how 0053 was skipped silently.
REM ---------------------------------------------------------------------------
set ERRORS=0

echo.
echo [1/4] Regenerating the Prisma client...
call npx prisma generate || goto :fail

echo.
echo [2/4] Applying the numbered scripts, in order...
for %%S in (
  0051-sampling-and-catalogue.sql
  0052-user-alt-role-context.sql
  0053-sampling-source-qc.sql
) do (
  if not exist "scripts\%%S" (
    echo   MISSING: scripts\%%S  -- this file is not in your tree.
    set /a ERRORS+=1
  ) else (
    echo   applying %%S
    call npx prisma db execute --schema prisma/schema.prisma --file scripts/%%S || set /a ERRORS+=1
  )
)
if !ERRORS! GTR 0 (
  echo.
  echo STOPPED: !ERRORS! script^(s^) missing or failed. Fix those before continuing —
  echo          a partial schema is worse than an unchanged one.
  exit /b 1
)

echo.
echo [3/4] Syncing anything still missing from the model...
echo       alt_role / alt_branch / smtp_* / mail_* are DECLARED now, so this
echo       ADDS them instead of dropping them. That was the bug.
call npx prisma db push || goto :fail

echo.
echo [4/4] Running the test suite...
call npm test

echo.
echo Done. Restart "npm run dev" and reload /admin/users.
goto :eof

:fail
echo.
echo FAILED - fix the error above and run this again.
exit /b 1
