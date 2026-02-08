#!/usr/bin/env node

/**
 * Pallet Guard Headless Service
 * 
 * Monitors Capstone Apex PO data for restack/upstack overages and auto-cancels 
 * driver wallet payments. Runs on AWS/Linux servers without GUI.
 */

require('dotenv').config();
const express = require('express');

const auth = require('./src/auth');
const scanner = require('./src/scanner');
const notifier = require('./src/notifier');

// Service state
let apexToken = null;
let loadEntryToken = null;
let scanInterval = null;
let isScanning = false;
let lastScanResult = null;
let scanStats = {
  totalScans: 0,
  successfulScans: 0,
  errors: 0,
  lastError: null,
  startTime: new Date(),
  lastScanTime: null
};

// Logging
function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

// Authentication flow
async function authenticate() {
  try {
    log('🔐 Starting authentication...');
    
    log('📡 Authenticating with Apex (form POST to apex.capstonelogistics.com)...');
    apexToken = await auth.getApexToken();
    log(`✅ Apex Token acquired (${apexToken.substring(0, 20)}...)`);
    
    log('🌐 Authenticating with Load Entry (Microsoft B2C SSO flow)...');
    loadEntryToken = await auth.getLoadEntryToken();
    log(`✅ Load Entry B2C token acquired (${loadEntryToken.substring(0, 20)}...)`);
    
    log('🎯 Authentication complete - ready to scan');
    return true;
  } catch (error) {
    log(`❌ Authentication failed: ${error.message}`);
    scanStats.lastError = error.message;
    return false;
  }
}

// Re-authentication on 401
async function reauth(which) {
  log(`🔄 ${which} token expired — re-authenticating...`);
  
  try {
    if (which === 'Apex' || which === 'both') {
      apexToken = await auth.getApexToken();
      log('✅ Apex re-auth successful');
    }
    if (which === 'Load Entry' || which === 'both') {
      loadEntryToken = await auth.getLoadEntryToken();
      log('✅ Load Entry re-auth successful');
    }
    return true;
  } catch (error) {
    log(`❌ Re-auth failed: ${error.message}`);
    scanStats.lastError = error.message;
    return false;
  }
}

// Main scanning logic
async function performScan() {
  if (!apexToken || !loadEntryToken) {
    log('❌ Cannot scan — not authenticated');
    return false;
  }

  try {
    scanStats.totalScans++;
    scanStats.lastScanTime = new Date();
    
    // Scan both subdepts 85 & 86
    const subdepts = [85, 86];
    const result = await scanner.scan(subdepts, apexToken, loadEntryToken, log);
    
    lastScanResult = {
      timestamp: new Date().toISOString(),
      poCount: result.poData.length,
      overCount: result.poData.filter(p => p.status === 'OVER').length,
      cancelledCount: result.poData.filter(p => p.status === 'CANCELLED').length,
      actions: result.actions.length,
      poData: result.poData
    };

    // Send email alerts
    for (const action of result.actions) {
      if (action.type === 'cancelled' || action.type === 'over-no-wallet') {
        try {
          await notifier.sendEmail(action);
          log(`📧 Email sent to ${process.env.NOTIFY_EMAIL} for PO ${action.poNumber} (${action.type})`);
        } catch (emailErr) {
          log(`⚠️ Email failed: ${emailErr.message}`);
        }
      }
    }

    scanStats.successfulScans++;
    log(`✅ Scan cycle complete: ${result.poData.length} POs, ${result.actions.length} actions taken`);
    return true;

  } catch (error) {
    scanStats.errors++;
    const msg = error.message || '';
    
    // Handle 401 re-auth
    if (msg.includes('401')) {
      const isApex = msg.includes('siteadminsso') || msg.includes('Apex');
      const isLE = msg.includes('loadentry') || msg.includes('LoadEntry');
      const which = isApex && isLE ? 'both' : isApex ? 'Apex' : isLE ? 'Load Entry' : 'both';
      
      const success = await reauth(which);
      if (success) {
        log('🔄 Re-auth succeeded — will retry on next cycle');
        return false; // Don't count as failed scan
      } else {
        log('💥 Re-auth failed — stopping scanner');
        stopScanning();
        return false;
      }
    } else {
      log(`❌ Scan error: ${msg}`);
      scanStats.lastError = msg;
      return false;
    }
  }
}

// Scanning control
function startScanning() {
  if (isScanning) {
    log('⚠️ Scanner already running');
    return false;
  }

  log('🚀 Starting scanner — monitoring subdepts 85 & 86 every 10 seconds');
  isScanning = true;
  
  // Initial scan
  performScan();
  
  // Set up interval
  scanInterval = setInterval(async () => {
    if (isScanning) {
      await performScan();
    }
  }, 10000); // 10 seconds

  return true;
}

function stopScanning() {
  if (!isScanning) {
    log('⚠️ Scanner not running');
    return false;
  }

  log('🛑 Stopping scanner');
  isScanning = false;
  
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }

  return true;
}

// Web Dashboard API
const app = express();
app.use(express.json());

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    service: 'Pallet Guard Headless',
    version: '1.0.0',
    uptime: Math.floor((Date.now() - scanStats.startTime.getTime()) / 1000),
    authenticated: !!(apexToken && loadEntryToken),
    scanning: isScanning,
    stats: scanStats,
    lastScan: lastScanResult
  });
});

// Control endpoints
app.post('/api/auth', async (req, res) => {
  const success = await authenticate();
  res.json({ success, authenticated: !!(apexToken && loadEntryToken) });
});

app.post('/api/scan/start', (req, res) => {
  if (!apexToken || !loadEntryToken) {
    return res.status(400).json({ error: 'Not authenticated' });
  }
  
  const success = startScanning();
  res.json({ success, scanning: isScanning });
});

app.post('/api/scan/stop', (req, res) => {
  const success = stopScanning();
  res.json({ success, scanning: isScanning });
});

// Simple web dashboard
app.get('/', (req, res) => {
  const uptime = Math.floor((Date.now() - scanStats.startTime.getTime()) / 1000);
  const uptimeHours = Math.floor(uptime / 3600);
  const uptimeMinutes = Math.floor((uptime % 3600) / 60);
  
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Pallet Guard - Monitoring Dashboard</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: monospace; background: #0a0f1a; color: #e8ecf1; margin: 20px; }
        .header { color: #f0a030; font-size: 24px; margin-bottom: 20px; }
        .status { display: flex; gap: 20px; margin-bottom: 20px; }
        .card { background: #12161c; border: 1px solid #2a3140; border-radius: 8px; padding: 15px; }
        .metric { font-size: 18px; color: #f0a030; }
        .label { color: #8895a7; font-size: 12px; }
        .ok { color: #2dd4a0; }
        .warn { color: #f0a030; }
        .error { color: #ef4444; }
        .actions { margin-top: 20px; }
        button { background: #2a3140; color: #e8ecf1; border: 1px solid #3a4555; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-right: 10px; }
        button:hover { background: #3a4555; }
        .recent-data { margin-top: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid #2a3140; }
        th { color: #f0a030; }
        .refresh { position: fixed; top: 20px; right: 20px; }
    </style>
    <script>
        function refresh() { location.reload(); }
        setInterval(refresh, 30000); // Auto-refresh every 30s
        
        async function apiCall(endpoint, method = 'GET') {
            const response = await fetch('/api/' + endpoint, { method });
            const result = await response.json();
            alert(JSON.stringify(result, null, 2));
            setTimeout(refresh, 1000);
        }
    </script>
</head>
<body>
    <div class="header">🛡️ PALLET GUARD MONITORING</div>
    
    <div class="status">
        <div class="card">
            <div class="metric ${apexToken && loadEntryToken ? 'ok' : 'error'}">${apexToken && loadEntryToken ? 'AUTHENTICATED' : 'NOT AUTHENTICATED'}</div>
            <div class="label">Authentication Status</div>
        </div>
        
        <div class="card">
            <div class="metric ${isScanning ? 'ok' : 'warn'}">${isScanning ? 'SCANNING' : 'STOPPED'}</div>
            <div class="label">Scanner Status</div>
        </div>
        
        <div class="card">
            <div class="metric">${uptimeHours}h ${uptimeMinutes}m</div>
            <div class="label">Uptime</div>
        </div>
        
        <div class="card">
            <div class="metric">${scanStats.successfulScans}/${scanStats.totalScans}</div>
            <div class="label">Successful Scans</div>
        </div>
    </div>
    
    ${lastScanResult ? `
    <div class="card recent-data">
        <h3>Last Scan Results</h3>
        <p><strong>Time:</strong> ${new Date(lastScanResult.timestamp).toLocaleString()}</p>
        <p><strong>PO Count:</strong> ${lastScanResult.poCount} | <strong>Over Limit:</strong> ${lastScanResult.overCount} | <strong>Cancelled:</strong> ${lastScanResult.cancelledCount}</p>
        <p><strong>Actions Taken:</strong> ${lastScanResult.actions}</p>
    </div>
    ` : ''}
    
    ${scanStats.lastError ? `
    <div class="card">
        <h3 class="error">Last Error</h3>
        <p>${scanStats.lastError}</p>
    </div>
    ` : ''}
    
    <div class="actions">
        <button onclick="apiCall('auth', 'POST')">Re-Authenticate</button>
        <button onclick="apiCall('scan/start', 'POST')">Start Scanner</button>
        <button onclick="apiCall('scan/stop', 'POST')">Stop Scanner</button>
        <button onclick="refresh()">Refresh</button>
    </div>
    
    <button class="refresh" onclick="refresh()">🔄 Refresh</button>
</body>
</html>
  `);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  log('🛑 Received SIGINT - shutting down gracefully...');
  
  stopScanning();
  
  try {
    await auth.closeBrowser();
    log('✅ Browser closed');
  } catch (e) {
    log(`⚠️ Error closing browser: ${e.message}`);
  }
  
  log('👋 Pallet Guard service stopped');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('🛑 Received SIGTERM - shutting down gracefully...');
  stopScanning();
  await auth.closeBrowser();
  process.exit(0);
});

// Auto-start
async function main() {
  const port = process.env.PORT || 3000;
  
  app.listen(port, () => {
    log(`🌐 Web dashboard running on http://localhost:${port}`);
    log('🛡️ Pallet Guard Headless Service v1.0.0');
    log('📧 Email alerts configured for: ' + (process.env.NOTIFY_EMAIL || 'NOT SET'));
    log('🏢 Monitoring subdepts: 85, 86');
  });

  // Auto-authenticate and start scanning
  const authSuccess = await authenticate();
  if (authSuccess) {
    startScanning();
  } else {
    log('❌ Initial authentication failed - use web dashboard to retry');
  }
}

// Start the service
if (require.main === module) {
  main().catch(error => {
    log(`💥 Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main };