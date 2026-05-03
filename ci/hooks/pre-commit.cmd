@echo off
REM Pre-commit hook for Windows
REM Git on Windows checks for pre-commit.cmd when pre-commit (shell) is not executable

echo 🔍 Running pre-commit checks...

cd kimi-code-swarm || exit /b 1

echo.
echo [1/4] TypeScript type check...
call npm run typecheck || exit /b 1

echo.
echo [2/4] ESLint code check...
call npm run lint || exit /b 1

echo.
echo [3/4] AST structure analysis...
call npm run analyze || exit /b 1

echo.
echo [4/4] Documentation sync check...
call npx tsx ../ci/scripts/check-docs-sync.ts || exit /b 1

echo.
echo ✅ Pre-commit checks passed
