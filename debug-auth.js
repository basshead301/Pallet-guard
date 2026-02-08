const { chromium } = require('playwright');
require('dotenv').config();

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
  const page = await ctx.newPage();
  
  console.log('Loading login page...');
  await page.goto('https://apex.capstonelogistics.com/home', { waitUntil: 'networkidle', timeout: 30000 });
  console.log('URL:', page.url());
  console.log('TITLE:', await page.title());
  
  // Check what's on the page
  const inputs = await page.$$eval('input', els => els.map(e => ({ name: e.name, id: e.id, type: e.type })));
  console.log('INPUTS:', JSON.stringify(inputs));
  
  const buttons = await page.$$eval('button, input[type=submit]', els => els.map(e => ({ tag: e.tagName, text: e.textContent || e.value, type: e.type })));
  console.log('BUTTONS:', JSON.stringify(buttons));
  
  // Try filling and submitting
  console.log('Filling credentials...');
  await page.fill('input[name="Username"], #Username', process.env.APEX_USERNAME || '');
  await page.fill('input[name="Password"], #Password', process.env.APEX_PASSWORD || '');
  
  console.log('Submitting...');
  await page.click('button[type="submit"], input[type="submit"]');
  
  // Wait and check
  await page.waitForTimeout(5000);
  console.log('POST-LOGIN URL:', page.url());
  
  const cookies = await ctx.cookies();
  console.log('ALL COOKIES:', JSON.stringify(cookies.map(c => ({ name: c.name, domain: c.domain, value: c.value.substring(0, 30) }))));
  
  // Check for error messages on page
  const bodyText = await page.textContent('body');
  if (bodyText.includes('Invalid') || bodyText.includes('incorrect') || bodyText.includes('error')) {
    console.log('PAGE ERRORS:', bodyText.substring(0, 500));
  }
  
  await browser.close();
})().catch(e => console.error('ERROR:', e.message));
