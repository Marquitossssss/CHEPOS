import { execSync } from 'node:child_process';

try {
  execSync('pnpm -r --if-present --filter=!articket-platform test', {
    stdio: 'inherit'
  });
} catch {
  process.exit(1);
}
