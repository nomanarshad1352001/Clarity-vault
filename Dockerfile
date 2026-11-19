# Multi-stage build keeps the image small and runs as a non-root user.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# next is only a dev-time typegen shim for the sandbox; it is not used at runtime
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public
COPY config ./config
COPY scripts ./scripts
RUN chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server/index.js"]
