FROM node:20-alpine AS builder

WORKDIR /app
RUN npm install -g pnpm
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/database ./packages/database
COPY apps/bot-orchestrator ./apps/bot-orchestrator
RUN pnpm install --frozen-lockfile
RUN pnpm --filter database dlx prisma generate
RUN pnpm --filter bot-orchestrator build

FROM node:20-alpine AS runner

WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN npm install -g pnpm

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=builder /app/apps/bot-orchestrator/dist ./dist
COPY --from=builder /app/apps/bot-orchestrator/package.json ./

USER appuser

ENV NODE_ENV=production
CMD ["node", "dist/main.js"]
