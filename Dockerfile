# IinPublic server — production image
# Build: docker build -t iinpublic-server .
# Run:   docker run -p 8080:8080 iinpublic-server

FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:server

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
# Copy compiled server output and static web assets
COPY --from=builder /app/dist/server ./dist/server
COPY --from=builder /app/public ./public
EXPOSE 8080
CMD ["node", "dist/server/index.js"]
