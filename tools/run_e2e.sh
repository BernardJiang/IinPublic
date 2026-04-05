#!/bin/bash

# Run tests and capture output
OUTPUT=$(npm run test:e2e  -- tests/e2e/01-login-and-headcount.spec.ts 2>&1)

# Limit size (VERY important)
echo "$OUTPUT" | tail -n 300
