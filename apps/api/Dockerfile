FROM node:22-alpine AS builder

WORKDIR /app
RUN apk add --no-cache openssl
RUN npm install -g pnpm
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile
RUN cd packages/database && pnpm exec prisma generate

RUN pnpm --filter @meetscribe/crypto build

RUN pnpm --filter @meetscribe/bot-pool build

RUN pnpm --filter @meetscribe/google-client build

RUN pnpm --filter @meeting-bot/api build
FROM node:22-alpine AS runner

WORKDIR /app
RUN apk add --no-cache openssl
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api

USER appuser

ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
