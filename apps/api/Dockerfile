FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm@9.12.0

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --no-frozen-lockfile

COPY . .

RUN pnpm --filter @articket/shared build
RUN pnpm --filter @articket/api exec prisma generate
RUN pnpm --filter @articket/api build
RUN pnpm deploy --filter @articket/api --prod /opt/api

FROM builder AS test
WORKDIR /app/apps/api
CMD ["pnpm", "test"]

FROM node:20-alpine AS runtime
WORKDIR /app/apps/api
ENV NODE_ENV=production

RUN npm install -g pnpm@9.12.0

COPY --from=builder /opt/api ./
COPY --from=builder /app/apps/api/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 3000
CMD ["sh", "entrypoint.sh", "api"]
