#  Platform

## Demo-rich seed verification (dev)

Use this to populate deterministic demo data and verify dataset invariants:

```bash
SEED_PROFILE=demo_rich pnpm -w db:seed
pnpm -w seed:verify
pnpm -w seed:verify -- --json
```

In CI (`seed-verify-demo-rich` job):
- Check **Step Summary** for quick status.
- Download artifact `seed-verify-demo-rich` for `seed-verify.json` + `seed-verify.txt`.
