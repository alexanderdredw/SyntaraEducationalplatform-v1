// `pnpm dev` пакета: следит за обеими сборками — CommonJS (api, worker, Node) и ESM (web, OPT-05 О4-1).
import { spawn } from 'node:child_process';

const tsc = (project) =>
  spawn('tsc', ['-p', project, '--watch', '--preserveWatchOutput'], { stdio: 'inherit', shell: true });
const children = [tsc('tsconfig.build.json'), tsc('tsconfig.build.esm.json')];
for (const c of children) c.on('exit', (code) => process.exit(code ?? 0));
