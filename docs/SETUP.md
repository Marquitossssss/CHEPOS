# SETUP (máquina limpia)

## Prerrequisitos
- Docker + Docker Compose
- Git

## Variables de entorno
```bash
cp .env.example .env
```

> No subir `.env` al repositorio.

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
