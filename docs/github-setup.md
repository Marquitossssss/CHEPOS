# GitHub setup (repositorio privado)

## Crear repo privado
Nombre sugerido: `articket-platform`.

### Opción web
1. GitHub → New repository
2. Name: `articket-platform`
3. Visibility: `Private`
4. No subir secretos ni `.env`

### Opción CLI (`gh`) si disponible
```bash
gh repo create articket-platform --private --source . --remote origin --push
```

## Protección de branch `main`
Settings → Branches → Add rule:
- Require a pull request before merging
- Require status checks to pass before merging
- Required checks: `CI`
- Require branches to be up to date before merging

## Primer push manual
```bash
git branch -M main
git remote add origin git@github.com:<owner>/articket-platform.git
git push -u origin main
```
