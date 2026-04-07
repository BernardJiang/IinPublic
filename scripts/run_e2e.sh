#!/bin/bash

cd ~/IinPublic

LOG_FILE="logs/test_$(date +%s).log"

echo "🚀 Running E2E tests in background..."

# run in background
nohup npm run test:e2e -- tests/e2e/01-login-single-user-headcount.spec.ts > "$LOG_FILE" 2>&1 &

echo "✅ Test started"
echo "📄 Log file: $LOG_FILE"
