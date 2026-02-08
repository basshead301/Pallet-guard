/**
 * Authentication module for Capstone Apex & Load Entry using Playwright.
 * Headless version of the Electron auth flow.
 *
 * Flow:
 * 1. POST form to apex.capstonelogistics.com/home (Username, Password, RememberMe)
 *    → .AspNetCore.Cookies + Token cookies → Token value = Bearer for siteadminsso API
 * 2. Navigate to apexloadentry.capstonelogistics.com → Microsoft B2C SSO redirect
 *    → Fill email/password on login.microsoftonline.com → handle "Stay signed in?" → 
 *    → redirected back → localStorage.getItem('token') = Bearer for loadentryapi
 */

const { chromium } = require('playwright');

const APEX_LOGIN_URL = 'https://apex.capstonelogistics.com/home';
const LOAD_ENTRY_URL = 'https://apexloadentry.capstonelogistics.com/';

let browserContext = null;

async function getBrowserContext() {
  if (!browserContext) {
    const browser = await chromium.launch({ headless: true });
    browserContext = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
  }
  return browserContext;
}

async function getApexToken() {
  const context = await getBrowserContext();
  const page = await context.newPage();

  try {
    console.log('[AUTH] Loading Apex login page...');
    await page.goto(APEX_LOGIN_URL, { waitUntil: 'networkidle' });

    // Fill in credentials
    console.log('[AUTH] Filling Apex credentials...');
    await page.fill('input[name="Username"], #Username', process.env.APEX_USERNAME || '');
    await page.fill('input[name="Password"], #Password', process.env.APEX_PASSWORD || '');
    
    // Check RememberMe if it exists
    const rememberMe = page.locator('input[name="RememberMe"]');
    if (await rememberMe.isVisible()) {
      await rememberMe.check();
    }

    // Submit form
    console.log('[AUTH] Submitting login form...');
    await page.click('button[type="submit"], input[type="submit"]');
    
    // Poll for Token cookie up to 30 seconds
    let tokenCookie = null;
    const maxWait = 30000;
    const pollInterval = 1000;
    const start = Date.now();
    
    while (Date.now() - start < maxWait) {
      const cookies = await context.cookies();
      tokenCookie = cookies.find(c => c.name === 'Token' && c.domain.includes('capstonelogistics.com'));
      if (tokenCookie && tokenCookie.value) break;
      await page.waitForTimeout(pollInterval);
    }
    
    if (!tokenCookie || !tokenCookie.value) {
      throw new Error('Apex Token cookie not found after 30s - login may have failed');
    }

    console.log(`[AUTH] ✓ Apex Token acquired (${tokenCookie.value.substring(0, 20)}...)`);
    return tokenCookie.value;

  } finally {
    await page.close();
  }
}

async function getLoadEntryToken() {
  const context = await getBrowserContext();
  const page = await context.newPage();

  try {
    console.log('[AUTH] Loading Load Entry page...');
    await page.goto(LOAD_ENTRY_URL, { waitUntil: 'networkidle' });

    // Handle Microsoft B2C authentication flow
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds timeout

    while (attempts < maxAttempts) {
      const url = page.url();
      console.log(`[AUTH] Current URL: ${url}`);

      // Check if we're back on Load Entry with token in localStorage
      if (url.includes('apexloadentry.capstonelogistics.com')) {
        try {
          const token = await page.evaluate(() => {
            const raw = localStorage.getItem('token');
            return raw ? raw.replace(/^"|"$/g, '') : null;
          });
          
          if (token && token.length > 20) {
            console.log(`[AUTH] ✓ Load Entry token acquired (${token.substring(0, 20)}...)`);
            return token;
          }
        } catch (e) {
          // localStorage not accessible yet, continue
        }
      }

      // Handle Microsoft login screens
      if (url.includes('login.microsoftonline.com') || url.includes('.b2clogin.com') || url.includes('capstonelogisticspartners')) {
        await handleMicrosoftLogin(page);
      }

      await page.waitForTimeout(1000);
      attempts++;
    }

    throw new Error('Load Entry authentication timed out');

  } finally {
    await page.close();
  }
}

async function handleMicrosoftLogin(page) {
  try {
    // Check for "Stay signed in?" prompt
    const stayButton = page.locator('#idSIButton9, #idBtn_Back');
    if (await stayButton.isVisible() && await page.textContent('body').then(text => 
      text.includes('Stay signed in') || text.includes('remain signed in')
    )) {
      console.log('[AUTH] Clicking "Stay signed in"...');
      await stayButton.click();
      return;
    }

    // Password field visible? Fill and submit
    const passField = page.locator('input[type="password"][name="passwd"], input[type="password"]');
    if (await passField.isVisible()) {
      console.log('[AUTH] Filling password...');
      await passField.fill(process.env.LOADENTRY_PASSWORD || '');
      await page.waitForTimeout(300);
      
      const signInBtn = page.locator('input[type="submit"][value="Sign in"], input[type="submit"], #idSIButton9').first();
      if (await signInBtn.isVisible()) {
        await signInBtn.click();
      }
      return;
    }

    // Email field visible? Fill and submit
    const emailField = page.locator('input[type="email"][name="loginfmt"], input[name="loginfmt"]');
    if (await emailField.isVisible()) {
      console.log('[AUTH] Filling email...');
      await emailField.fill(process.env.LOADENTRY_EMAIL || '');
      await page.waitForTimeout(300);
      
      const nextBtn = page.locator('input[type="submit"][value="Next"], input[type="submit"], #idSIButton9').first();
      if (await nextBtn.isVisible()) {
        await nextBtn.click();
      }
      return;
    }

    // B2C custom policy forms
    const b2cEmail = page.locator('input[name="signInName"], #signInName, #email, input[id*="email"], input[placeholder*="email" i]');
    const b2cPass = page.locator('input[name="password"], #password, input[id*="password"], input[type="password"]');
    
    // Both fields present — fill both and submit
    if (await b2cEmail.isVisible() && await b2cPass.isVisible()) {
      console.log('[AUTH] Filling B2C combined form...');
      await b2cEmail.fill(process.env.LOADENTRY_EMAIL || '');
      await b2cPass.fill(process.env.LOADENTRY_PASSWORD || '');
      
      const submitBtn = page.locator('#next, button[type="submit"], input[type="submit"]').first();
      if (await submitBtn.isVisible()) {
        await page.waitForTimeout(300);
        await submitBtn.click();
      }
      return;
    }
    
    // Only email/signInName field — fill and submit
    if (await b2cEmail.isVisible()) {
      console.log('[AUTH] Filling B2C email field...');
      await b2cEmail.fill(process.env.LOADENTRY_EMAIL || '');
      
      const submitBtn = page.locator('#next, button[type="submit"], input[type="submit"]').first();
      if (await submitBtn.isVisible()) {
        await page.waitForTimeout(300);
        await submitBtn.click();
      }
      return;
    }
    
    // Only password field — fill and submit
    if (await b2cPass.isVisible()) {
      console.log('[AUTH] Filling B2C password field...');
      await b2cPass.fill(process.env.LOADENTRY_PASSWORD || '');
      
      const submitBtn = page.locator('#next, button[type="submit"], input[type="submit"]').first();
      if (await submitBtn.isVisible()) {
        await page.waitForTimeout(300);
        await submitBtn.click();
      }
      return;
    }

  } catch (e) {
    console.log(`[AUTH] Error handling Microsoft login: ${e.message}`);
  }
}

async function closeBrowser() {
  if (browserContext) {
    await browserContext.browser().close();
    browserContext = null;
  }
}

module.exports = { getApexToken, getLoadEntryToken, closeBrowser };