FROM node:22-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/websocket-server ./apps/websocket-server
RUN pnpm install --frozen-lockfile

RUN cd apps/websocket-server && npm run build

FROM node:22-alpine AS runner

WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/websocket-server ./apps/websocket-server

USER appuser

ENV NODE_ENV=production
EXPOSE 3001
WORKDIR /app/apps/websocket-server
CMD ["node", "dist/server.js"]
