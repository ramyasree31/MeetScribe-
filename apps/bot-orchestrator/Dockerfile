FROM node:22-alpine AS builder

WORKDIR /app
RUN apk add --no-cache openssl
RUN npm install -g pnpm
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/database ./packages/database
COPY packages/bot-pool ./packages/bot-pool
COPY apps/bot-orchestrator ./apps/bot-orchestrator
RUN pnpm install --frozen-lockfile
RUN cd packages/database && pnpm exec prisma generate
# Use pre-compiled dist if present, otherwise build from source
RUN if [ ! -f apps/bot-orchestrator/dist/main.js ]; then pnpm --filter @meeting-bot/bot-orchestrator build; fi

FROM node:22-alpine AS runner

WORKDIR /app
RUN apk add --no-cache openssl
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/database ./packages/database
COPY --from=builder /app/packages/bot-pool ./packages/bot-pool
COPY --from=builder /app/apps/bot-orchestrator ./apps/bot-orchestrator

ENV NODE_ENV=production
WORKDIR /app/apps/bot-orchestrator
CMD ["node", "dist/main.js"]
