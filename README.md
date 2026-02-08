# Pallet Guard Headless Service

Headless version of Pallet Guard for AWS deployment. Monitors Capstone Apex PO data and auto-cancels driver wallet payments when restack/upstack counts exceed pallet limits.

## Features

- 🔐 **Automated Authentication**: Handles Apex form login + Load Entry B2C SSO using Playwright headless browser
- 📊 **Dual Monitoring**: Scans both subdepts 85 & 86 every 10 seconds
- 🚫 **Auto-Cancellation**: Voids driver wallet payments when R+U > pallet count
- 📧 **Email Alerts**: Sends notifications for cancelled payments and over-limit POs
- 🌐 **Web Dashboard**: Simple monitoring interface at http://server:3000
- ♻️ **Self-Healing**: Auto re-authenticates on token expiry, restarts on crashes
- ⏰ **2AM Day Boundary**: Respects warehouse shift schedule (midnight-1:59 AM = previous day)

## Quick Start

### 1. Install Dependencies
```bash
npm install
npx playwright install chromium
```

### 2. Configure Environment
Copy `.env` and update credentials:
```bash
APEX_USERNAME=Gary.Stine
APEX_PASSWORD=your_password
LOADENTRY_EMAIL=30086smgr@capstonelogistics.com  
LOADENTRY_PASSWORD=your_password
GMAIL_ADDRESS=garystine81@gmail.com
GMAIL_APP_PASSWORD=your_gmail_app_password
NOTIFY_EMAIL=30086smgr@capstonelogistics.com
```

### 3. Run Service
```bash
npm start
```

Visit http://localhost:3000 for the dashboard.

## AWS Deployment

### Recommended Instance
- **t4g.micro** (1 vCPU, 1GB RAM) - ~$3/month
- **Ubuntu 22.04 LTS** 
- **10GB storage** (5GB free tier)

### Deployment Steps

1. **Launch EC2 Instance**
   ```bash
   # Connect via SSH
   ssh -i your-key.pem ubuntu@your-server-ip
   ```

2. **Install Node.js**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   node --version  # Should be 18.x+
   ```

3. **Install Dependencies**
   ```bash
   sudo apt-get update
   sudo apt-get install -y git
   
   # Install Playwright dependencies
   npx playwright install-deps
   ```

4. **Deploy Service**
   ```bash
   git clone <your-repo-url> pallet-guard
   cd pallet-guard
   npm install
   npx playwright install chromium
   
   # Copy your .env file
   nano .env  # Paste your environment variables
   ```

5. **Create Systemd Service**
   ```bash
   sudo nano /etc/systemd/system/pallet-guard.service
   ```
   
   Paste:
   ```ini
   [Unit]
   Description=Pallet Guard Monitoring Service
   After=network.target
   
   [Service]
   Type=simple
   User=ubuntu
   WorkingDirectory=/home/ubuntu/pallet-guard
   ExecStart=/usr/bin/node index.js
   Restart=always
   RestartSec=10
   Environment=NODE_ENV=production
   
   [Install]
   WantedBy=multi-user.target
   ```

6. **Start Service**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable pallet-guard
   sudo systemctl start pallet-guard
   
   # Check status
   sudo systemctl status pallet-guard
   sudo journalctl -u pallet-guard -f  # View logs
   ```

7. **Configure Security Group**
   - Allow SSH (port 22) from your IP
   - Allow HTTP (port 3000) from your IP for dashboard access
   - All outbound traffic allowed (for API calls)

## Usage

### Web Dashboard
Visit `http://your-server-ip:3000` to:
- View real-time status and statistics
- Start/stop scanning
- Re-authenticate if needed
- Monitor recent scan results

### API Endpoints
```bash
# Status
curl http://localhost:3000/api/status

# Control
curl -X POST http://localhost:3000/api/auth
curl -X POST http://localhost:3000/api/scan/start
curl -X POST http://localhost:3000/api/scan/stop
```

### Logs
```bash
# View service logs
sudo journalctl -u pallet-guard -f

# Recent logs
sudo journalctl -u pallet-guard --since "1 hour ago"
```

## Monitoring

### Health Check
```bash
# Simple health check script
curl -s http://localhost:3000/api/status | jq '.scanning'
```

### Email Test
The service will send email alerts to `NOTIFY_EMAIL` when:
- PO cancelled (wallet payment voided)
- PO over limit but no wallet payment found

## Troubleshooting

### Authentication Issues
```bash
# Check browser dependencies
npx playwright install chromium
sudo apt-get install -y libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libgtk-3-0

# Test auth manually
node -e "
const auth = require('./src/auth');
auth.getApexToken().then(token => console.log('Apex OK:', token.substring(0,20)));
"
```

### Service Management
```bash
# Restart service
sudo systemctl restart pallet-guard

# View detailed logs
sudo journalctl -u pallet-guard -n 100

# Stop service
sudo systemctl stop pallet-guard
```

### Performance Monitoring
```bash
# Check resource usage
top -p $(pgrep -f "node index.js")

# Memory usage
ps aux | grep "node index.js"
```

## Security Notes

- Service runs as `ubuntu` user (not root)
- Credentials stored in `.env` file (ensure proper permissions: `chmod 600 .env`)
- Web dashboard has no authentication (restrict Security Group access)
- Auto-updates disabled by default (manual updates recommended)

## Cost Optimization

- **t4g.nano**: ~$3/month (sufficient for this workload)
- **Spot instances**: ~70% cheaper but may be terminated
- **Reserved instances**: ~40% cheaper for 1-year commitment
- **Stop during maintenance**: Use `sudo systemctl stop pallet-guard`

## Support

For issues or questions:
- Check service logs: `sudo journalctl -u pallet-guard -f`
- Test authentication manually (see Troubleshooting)
- Monitor dashboard at http://server-ip:3000
- Email alerts indicate API/authentication issues