#!/usr/bin/env bash
# Build and deploy the server Docker image.
# Usage: ./scripts/deploy-server.sh [image-tag]
# Note: chmod +x to make executable before use
set -euo pipefail

TAG=${1:-latest}
IMAGE="iinpublic-server:$TAG"

echo "🔨 Building Docker image $IMAGE..."
docker build -t "$IMAGE" .

echo "🚀 Image built: $IMAGE"
echo "ℹ️  Push and deploy with:"
echo "   docker tag $IMAGE your-registry/$IMAGE"
echo "   docker push your-registry/$IMAGE"
echo "   # Then on your server:"
echo "   docker pull your-registry/$IMAGE && docker run -d -p 8080:8080 --env-file .env your-registry/$IMAGE"
