import { execSync } from 'node:child_process';

try {
  execSync('pnpm -w -r test', { stdio: 'inherit' });
} catch {
  process.exit(1);
}
