#!/bin/bash
set -e

cd ~/IinPublic

LOG_FILE="logs/test_$(date +%s).log"

echo "🚀 Running E2E tests..."

# Run test and save log
npm run test:e2e -- tests/e2e/01-login-and-headcount.spec.ts > "$LOG_FILE" 2>&1 || true

echo "🧠 Summarizing..."

# Extract useful part (avoid huge logs)
TAIL_LOG=$(tail -n 2000 "$LOG_FILE")

# 👉 THIS is where you modify prompt
SUMMARY=$(echo "$TAIL_LOG" | ollama run qwen2.5-coder:32b "
You are a senior software engineer.

Analyze the following test output and return:

1. Overall status (PASS or FAIL)
2. Failed test names
3. Root cause
4. Suggested fix (very concrete)

Keep it concise.

Test Output:
$TAIL_LOG
")

echo "===== SUMMARY ====="
echo "$SUMMARY"