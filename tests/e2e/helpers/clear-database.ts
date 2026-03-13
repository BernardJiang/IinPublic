import * as fs from 'fs';
import * as path from 'path';

/**
 * Clear all Gun.js databases (client, server disk, server memory)
 * Call this before each test suite to ensure a clean state
 */
export async function clearGunDatabases() {
  console.log('🧹 Clearing Gun.js databases to start fresh...');

  // Clear client/server radata (Gun file storage); recreate dir so next run can write (avoids ENOENT)
  const radataPath = path.join(__dirname, '../../../radata');
  if (fs.existsSync(radataPath)) {
    fs.rmSync(radataPath, { recursive: true, force: true });
    console.log('  ✅ Cleared client database (radata/)');
  }
  fs.mkdirSync(radataPath, { recursive: true });

  // Clear server database
  const serverDataPath = path.join(__dirname, '../../../data1.json');
  if (fs.existsSync(serverDataPath)) {
    fs.rmSync(serverDataPath, { recursive: true, force: true });
    console.log('  ✅ Cleared server database (data1.json)');
  }

  // Also check for data.json (alternative Gun database location)
  const altServerDataPath = path.join(__dirname, '../../../data.json');
  if (fs.existsSync(altServerDataPath)) {
    fs.rmSync(altServerDataPath, { recursive: true, force: true });
    console.log('  ✅ Cleared alternate server database (data.json)');
  }

  // Clear .tmp files created by Gun.js
  const projectRoot = path.join(__dirname, '../../../');
  const tmpFiles = fs.readdirSync(projectRoot).filter((file) => file.endsWith('.tmp'));
  tmpFiles.forEach((file) => {
    fs.rmSync(path.join(projectRoot, file), { force: true });
  });
  if (tmpFiles.length > 0) {
    console.log(`  ✅ Cleared ${tmpFiles.length} .tmp files`);
  }

  // Clear Gun.js server in-memory database via API
  try {
    const response = await fetch('http://localhost:8080/api/test/clear-database', {
      method: 'POST',
    });
    if (response.ok) {
      console.log('  ✅ Cleared Gun.js server in-memory database');
    } else {
      console.warn('  ⚠️ Failed to clear Gun.js server database:', response.statusText);
    }
  } catch (error) {
    console.warn('  ⚠️ Could not connect to Gun.js server to clear database');
  }

  // Allow server and Gun to finish clearing before next test
  await new Promise((resolve) => setTimeout(resolve, 600));

  console.log('✅ All databases cleared');
}
