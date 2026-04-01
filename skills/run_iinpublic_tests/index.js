export async function run_iinpublic_tests() {
  const { execSync } = require('child_process');
  try {
    const output = execSync('npm run test:e2e', { encoding: 'utf8' }); 
    return `Tests Passed: \n${output}`;
  } catch (error) {
    return `Tests Failed: \n${error.stdout}`;
  }
}
