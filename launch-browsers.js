const { chromium } = require('playwright');
const path = require('path');

(async () => {
  console.log("🚀 Launching isolated Gun.js instances...");

  // User A - Custom data folder ensures unique LocalStorage
  const contextA = await chromium.launchPersistentContext(path.join(__dirname, 'user_data/user_a'), {
    headless: false,
    viewport: { width: 800, height: 800 },
    args: ['--window-position=0,0'] // Left side of screen
  });
  const pageA = contextA.pages()[0]; 
  await pageA.goto('http://localhost:3001'); // Replace with your port

  // User B - Different data folder = Different Gun.js ID
  const contextB = await chromium.launchPersistentContext(path.join(__dirname, 'user_data/user_b'), {
    headless: false,
    viewport: { width: 800, height: 800 },
    args: ['--window-position=810,0'] // Right side of screen
  });
  const pageB = contextB.pages()[0];
  await pageB.goto('http://localhost:3001');

  console.log("✅ Both instances are live. User A and User B are now isolated.");

  // This keeps the Node process alive so the browsers don't close
  await new Promise(() => {}); 
})();