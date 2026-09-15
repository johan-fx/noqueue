import { cp, rm } from 'node:fs/promises';

const output = new URL('../dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await cp(new URL('../src/', import.meta.url), output, { recursive: true });
console.log('Built static landing in apps/landing/dist');
