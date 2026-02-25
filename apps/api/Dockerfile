FROM node:20-alpine
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install -g pnpm@9.12.0
COPY . .

# Instala dependencias dentro del contenedor usando lockfile versionado.
RUN pnpm install --filter @articket/api... --frozen-lockfile --prefer-offline || pnpm install --filter @articket/api... --no-frozen-lockfile

WORKDIR /app/apps/api
EXPOSE 3000
CMD ["sh", "entrypoint.sh"]
