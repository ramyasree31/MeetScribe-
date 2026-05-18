.PHONY: dev migrate seed

dev:
	docker-compose up -d
	pnpm run dev

migrate:
	pnpm --filter database dlx prisma migrate dev

seed:
	pnpm --filter database dlx prisma db seed
