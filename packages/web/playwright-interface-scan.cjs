const { chromium } = require('playwright');

const BASE_URL = 'https://rover.xaedron.com';
const AUTH_TOKEN = '8c2eae820354a8fa4479b1d1d6adc5a5e7ec2bdbbd1169ec998db521ec16575';

async function scanInterface() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 }
  });
  
  // Inject auth token
  await context.addInitScript((token) => {
    sessionStorage.setItem('rover_token', token);
  }, AUTH_TOKEN);
  
  const page = await context.newPage();
  const issues = [];
  
  console.log('🔍 Scanning Rover Interface...\n');
  
  // Test 1: Login/Initial Load
  try {
    console.log('1️⃣ Testing initial load...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    const sidebar = await page.$('.sidebar');
    if (!sidebar) {
      issues.push('❌ Sidebar not found');
    } else {
      console.log('   ✅ Sidebar loaded');
    }
  } catch (e) {
    issues.push(`❌ Initial load failed: ${e.message}`);
  }
  
  // Test 2: Projects Page
  try {
    console.log('2️⃣ Testing Projects page...');
    await page.click('[data-page="projects"]');
    await page.waitForTimeout(1500);
    
    const projectsGrid = await page.$('#projects-grid');
    if (!projectsGrid) {
      issues.push('❌ Projects grid not found');
    } else {
      console.log('   ✅ Projects page loaded');
      
      // Check if FPX Laureline project is visible
      const projectCard = await page.$('.project-card');
      if (projectCard) {
        const title = await projectCard.$eval('.project-card-title', el => el.textContent).catch(() => null);
        console.log(`   📋 Found project: ${title || 'Unknown'}`);
      } else {
        console.log('   ⚠️ No project cards found (may need to load a project)');
      }
    }
  } catch (e) {
    issues.push(`❌ Projects page error: ${e.message}`);
  }
  
  // Test 3: Director Chat Page
  try {
    console.log('3️⃣ Testing Director Chat page...');
    await page.click('[data-page="director"]');
    await page.waitForTimeout(1500);
    
    const chatMessages = await page.$('#director-chat-messages');
    if (!chatMessages) {
      issues.push('❌ Director chat messages container not found');
    } else {
      console.log('   ✅ Director Chat page loaded');
    }
    
    // Test sending a message
    const input = await page.$('#director-input');
    if (input) {
      await input.fill('Test message from Playwright');
      const sendBtn = await page.$('button[onclick="sendDirectorMessage()"]');
      if (sendBtn) {
        console.log('   ✅ Chat input and send button found');
      } else {
        issues.push('❌ Send button not found');
      }
    } else {
      issues.push('❌ Chat input not found');
    }
  } catch (e) {
    issues.push(`❌ Director Chat page error: ${e.message}`);
  }
  
  // Test 4: Workers Page
  try {
    console.log('4️⃣ Testing Workers page...');
    await page.click('[data-page="workers"]');
    await page.waitForTimeout(1500);
    
    const workersList = await page.$('#workers-list');
    if (!workersList) {
      issues.push('❌ Workers list not found');
    } else {
      console.log('   ✅ Workers page loaded');
    }
  } catch (e) {
    issues.push(`❌ Workers page error: ${e.message}`);
  }
  
  // Test 5: Tasks Page
  try {
    console.log('5️⃣ Testing Tasks page...');
    await page.click('[data-page="tasks"]');
    await page.waitForTimeout(1500);
    
    const taskList = await page.$('#task-list-body');
    if (!taskList) {
      issues.push('❌ Task list not found');
    } else {
      console.log('   ✅ Tasks page loaded');
    }
  } catch (e) {
    issues.push(`❌ Tasks page error: ${e.message}`);
  }
  
  // Test 6: Load Project Modal
  try {
    console.log('6️⃣ Testing Load Project modal...');
    await page.click('#nav-load-project');
    await page.waitForTimeout(1000);
    
    const modal = await page.$('#load-project-modal');
    if (!modal) {
      issues.push('❌ Load Project modal not found');
    } else {
      const isVisible = await modal.evaluate(el => el.classList.contains('open'));
      if (isVisible) {
        console.log('   ✅ Load Project modal opens');
        
        // Check form fields
        const fields = ['project-name', 'project-base-repo', 'project-additional-repos'];
        for (const field of fields) {
          const el = await page.$(`#${field}`);
          if (!el) issues.push(`❌ Field #${field} not found`);
        }
        if (issues.filter(i => i.includes('Field')).length === 0) {
          console.log('   ✅ All form fields present');
        }
        
        // Close modal
        await page.click('button[onclick="closeLoadProjectModal()"]');
        await page.waitForTimeout(500);
      } else {
        issues.push('❌ Load Project modal not visible');
      }
    }
  } catch (e) {
    issues.push(`❌ Load Project modal error: ${e.message}`);
  }
  
  // Test 7: Check for JavaScript errors
  console.log('7️⃣ Checking for console errors...');
  const logs = await page.evaluate(() => {
    return window.consoleErrors || [];
  });
  
  // Take screenshot
  console.log('8️⃣ Taking screenshot...');
  await page.screenshot({ path: 'rover-interface-scan.png', fullPage: true });
  
  await browser.close();
  
  // Report
  console.log('\n' + '='.repeat(60));
  console.log('📊 SCAN RESULTS');
  console.log('='.repeat(60));
  
  if (issues.length === 0) {
    console.log('✅ No issues found!');
  } else {
    console.log(`❌ Found ${issues.length} issue(s):\n`);
    issues.forEach(issue => console.log(issue));
  }
  
  console.log('\n📸 Screenshot saved: rover-interface-scan.png');
  console.log('='.repeat(60));
  
  return issues;
}

scanInterface().catch(console.error);
