import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, '..', 'dist');
copyFileSync(join(dist, 'index.html'), join(dist, '404.html'));
