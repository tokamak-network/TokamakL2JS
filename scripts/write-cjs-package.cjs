const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'dist', 'cjs');
fs.mkdirSync(outDir, { recursive: true });

const pkgPath = path.join(outDir, 'package.json');
const pkg = { type: 'commonjs' };
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
