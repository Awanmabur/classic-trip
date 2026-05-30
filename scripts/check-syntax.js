const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function walk(dir, files = []) {
  for (const item of fs.readdirSync(dir)) {
    const p = path.join(dir, item);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, files);
    else if (p.endsWith('.js')) files.push(p);
  }
  return files;
}

let failed = false;
for (const file of walk(path.join(__dirname, '..', 'src'))) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
