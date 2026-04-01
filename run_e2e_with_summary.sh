#!/bin/bash
set -e

cd ~/IinPublic

echo "🚀 Running E2E tests..."

# Run test and capture output
OUTPUT=$(npm run test:e2e 2>&1)

echo "🧠 Summarizing with OpenClaw..."

# Send to OpenClaw (adjust command based on your setup)
SUMMARY=$(echo "$OUTPUT" | ./tools/openclaw/bin/openclaw ask "
Summarize this test result:
- Did it pass or fail?
- List failed tests
- Root cause
- Suggested fix
")

echo "===== SUMMARY ====="
echo "$SUMMARY"