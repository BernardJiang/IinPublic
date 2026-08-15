# IinPublic web app + relay — production image
# Build: docker build -t iinpublic .
# Run:   docker run --init -p 8080:8080 iinpublic

FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:production

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV RELAY_ONLY_HUB=1
ENV STAR_SERVER_PERSISTENCE=ephemeral
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist/server ./dist/server
COPY --from=builder /app/dist/web ./dist/web
COPY --from=builder /app/public ./public
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const tls=process.env.IINPUBLIC_TLS_TERMINATED_BY_PROXY!=='1';const m=require(tls?'https':'http');const r=m.get({host:'127.0.0.1',port:process.env.PORT||8080,path:'/health',rejectUnauthorized:false},x=>process.exit(x.statusCode===200?0:1));r.on('error',()=>process.exit(1))"
CMD ["node", "dist/server/server/index.js"]
