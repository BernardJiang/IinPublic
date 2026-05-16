const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const names = fs.readdirSync(root);
const targets = names.filter((name) => {
  return (
    name === 'radata' ||
    /^radata_w\d+$/.test(name) ||
    name === 'data.json' ||
    name === 'data.json.tmp'
  );
});

for (const name of targets) {
  const target = path.join(root, name);
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`Removed ${name}`);
}

if (targets.length === 0) {
  console.log('No persisted dev Gun data found.');
}
