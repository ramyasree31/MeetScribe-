FROM node:22-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile

# Remove any stale .next cache that may have been copied from the host
RUN rm -rf /app/apps/web/.next

RUN cd apps/web && pnpm run build

FROM node:22-alpine AS runner

WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web ./apps/web

USER appuser

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

WORKDIR /app/apps/web
CMD ["npm", "run", "start"]
