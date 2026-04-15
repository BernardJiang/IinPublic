#!/usr/bin/env bash
# Deploy the web bundle to a static host.
# Usage: ./scripts/deploy-web.sh [--env staging|production]
# Note: chmod +x to make executable before use
set -euo pipefail

ENV=${1:-production}
DIST_DIR="dist/web"

echo "🔨 Building web bundle for $ENV..."
NODE_ENV=$ENV npm run build:web

echo "📦 Web bundle ready at $DIST_DIR"
echo "ℹ️  Upload $DIST_DIR to your CDN / static host."
echo "   Example (AWS S3): aws s3 sync $DIST_DIR s3://your-bucket/ --delete"
echo "   Example (rsync):  rsync -avz --delete $DIST_DIR/ user@host:/var/www/iinpublic/"
