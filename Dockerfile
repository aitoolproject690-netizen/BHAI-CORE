FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=10000
ENV BHAI_STORE_BACKEND=json
ENV BHAI_STORE_FILE=/data/bhai-core-store.json

RUN mkdir -p /data && chown -R node:node /app /data
USER node

VOLUME ["/data"]
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 CMD node -e "fetch('http://127.0.0.1:10000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node","server.js"]
