#!/usr/bin/env bash
set -euo pipefail

cd ~/IinPublic

echo "== install/check =="
npm ci

echo "== build (web + server, skip Android) =="
npm run build:web
npm run build:server

echo "== unit tests =="
npm run health

echo "== e2e tests =="
npm run test:all

