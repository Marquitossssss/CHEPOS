FROM node:20-alpine
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json

RUN npm install -g pnpm@9.12.0
COPY . .

# Instala dependencias dentro del contenedor usando lockfile versionado.
RUN pnpm install --filter @articket/web... --frozen-lockfile --prefer-offline || pnpm install --filter @articket/web... --no-frozen-lockfile

WORKDIR /app/apps/web
EXPOSE 5173
CMD ["pnpm", "dev"]
