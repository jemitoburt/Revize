// Fails when a dependency has a license outside the project policy (see docs/licenses.md).
// Usage: node scripts/check-licenses.mjs
import { execFileSync } from 'node:child_process';

const PERMISSIVE = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'PostgreSQL',
  'CC0-1.0',
  'Unlicense',
  '(MIT OR CC0-1.0)',
  '(MIT OR Apache-2.0)',
  '(Apache-2.0 OR MIT)',
  // jszip: dual license, we use it under MIT.
  '(MIT OR GPL-3.0-or-later)',
  'Zlib',
  '(MIT AND Zlib)',
  'MIT/X11',
]);

/** Approved exceptions: package name prefix → reason. Keep in sync with docs/licenses.md. */
const APPROVED = {
  '@img/sharp-libvips-': 'LGPL-3.0 libvips used by sharp, dynamically linked (approved 2026-10-26)',
  lightningcss: 'MPL-2.0, build-time CSS tool of Vite, not shipped',
  'caniuse-lite': 'CC-BY-4.0 browser support data, build-time only',
};

const report = JSON.parse(
  execFileSync('pnpm', ['licenses', 'list', '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 }),
);

const violations = [];
for (const [license, packages] of Object.entries(report)) {
  if (PERMISSIVE.has(license)) continue;
  for (const pkg of packages) {
    const approved = Object.keys(APPROVED).some((prefix) => pkg.name.startsWith(prefix));
    if (!approved) violations.push(`${pkg.name}@${pkg.versions?.join(',') ?? '?'}: ${license}`);
  }
}

if (violations.length > 0) {
  console.error('Dependencies with licenses outside the policy:\n  ' + violations.join('\n  '));
  console.error('Ask for approval and record the exception in docs/licenses.md.');
  process.exit(1);
}
console.log('License check passed.');
