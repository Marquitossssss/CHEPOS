# SETUP (máquina limpia)

## Prerrequisitos
- Docker + Docker Compose
- Git

## Variables de entorno
```bash
cp .env.example .env
```

> No subir `.env` al repositorio.

Completar obligatoriamente en `.env`:
- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `QR_SECRET`

Si usás SendGrid en local, completar también:
- `SENDGRID_API_KEY`

### Generación recomendada de secretos
```bash
openssl rand -hex 32   # JWT_ACCESS_SECRET
openssl rand -hex 32   # JWT_REFRESH_SECRET
openssl rand -hex 32   # QR_SECRET
openssl rand -hex 24   # POSTGRES_PASSWORD
```

### DATABASE_URL
Definila en `.env` usando tus valores reales de `POSTGRES_*`.

## Comandos oficiales
```bash
./scripts/start.sh
./scripts/test.sh
./scripts/verify.sh
./scripts/lint.sh
```

## Crear repo privado en GitHub (si hay gh)
```bash
gh repo create articket-platform --private --source . --remote origin
git branch -M main
git push -u origin main
```

## Alternativa manual (sin gh)
1. Crear repo **private** en GitHub Web: `articket-platform`.
2. Ejecutar:
```bash
git branch -M main
git remote add origin git@github.com:<TU_USUARIO>/articket-platform.git
git push -u origin main
```

## Protección de rama main
En GitHub → Settings → Branches:
- Require pull request before merging
- Require status checks to pass (`CI`)
- Require branches up to date
