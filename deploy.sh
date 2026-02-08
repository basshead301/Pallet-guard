#!/bin/bash

# Pallet Guard Headless - AWS Deployment Script
# Run on Ubuntu EC2 instance as ubuntu user

set -e

echo "🛡️ Pallet Guard Headless - AWS Deployment"
echo "========================================"

# Check if running as root
if [ "$EUID" -eq 0 ]; then
  echo "❌ Don't run as root. Use ubuntu user instead."
  exit 1
fi

# Install Node.js 18.x
echo "📦 Installing Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

NODE_VERSION=$(node --version)
echo "✅ Node.js version: $NODE_VERSION"

# Install system dependencies
echo "📦 Installing system dependencies..."
sudo apt-get update
sudo apt-get install -y git

# Install Playwright system dependencies
echo "🎭 Installing Playwright dependencies..."
npx playwright install-deps chromium

# Install npm dependencies
echo "📦 Installing npm packages..."
npm install

# Install Playwright browser
echo "🌐 Installing Chromium browser..."
npx playwright install chromium

# Check for .env file
if [ ! -f ".env" ]; then
    echo "⚠️ Creating .env template..."
    cat > .env << EOF
APEX_USERNAME=Gary.Stine
APEX_PASSWORD=your_password_here
LOADENTRY_EMAIL=30086smgr@capstonelogistics.com
LOADENTRY_PASSWORD=your_password_here
GMAIL_ADDRESS=garystine81@gmail.com
GMAIL_APP_PASSWORD=your_gmail_app_password_here
NOTIFY_EMAIL=30086smgr@capstonelogistics.com
PORT=3000
EOF
    echo "📝 Please edit .env with your actual credentials:"
    echo "   nano .env"
    read -p "Press Enter after editing .env..."
fi

# Set proper permissions
chmod 600 .env

# Create systemd service
echo "⚙️ Creating systemd service..."
sudo tee /etc/systemd/system/pallet-guard.service > /dev/null << EOF
[Unit]
Description=Pallet Guard Monitoring Service
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$(pwd)
ExecStart=$(which node) index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=pallet-guard

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
echo "🚀 Enabling service..."
sudo systemctl daemon-reload
sudo systemctl enable pallet-guard

# Start service
echo "▶️ Starting Pallet Guard service..."
sudo systemctl start pallet-guard

# Wait a moment for startup
sleep 3

# Check status
echo "📊 Service status:"
sudo systemctl status pallet-guard --no-pager

# Show logs
echo ""
echo "📋 Recent logs:"
sudo journalctl -u pallet-guard -n 10 --no-pager

# Show next steps
echo ""
echo "🎉 Deployment complete!"
echo ""
echo "Next steps:"
echo "1. Check dashboard: http://$(curl -s ifconfig.me):3000"
echo "2. View logs: sudo journalctl -u pallet-guard -f"
echo "3. Restart service: sudo systemctl restart pallet-guard"
echo "4. Stop service: sudo systemctl stop pallet-guard"
echo ""
echo "Security Group requirements:"
echo "- Allow inbound port 3000 from your IP (for dashboard)"
echo "- Allow outbound HTTPS (443) for API calls"
echo ""
echo "Monitor logs for authentication success..."