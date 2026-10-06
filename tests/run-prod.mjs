// Corre solo las pruebas de lectura contra producción (no hace login ni escribe nada).
import { spawnSync } from 'node:child_process';
const r = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PROD: '1' },
});
process.exit(r.status ?? 1);
