# Deployment Guide

This guide covers deploying the Weather Prediction Bot to production environments.

## Deployment Options

1. **Local machine** - For testing and development
2. **VPS/Cloud server** - Recommended for 24/7 operation
3. **Docker container** - For containerized deployments

---

## VPS Deployment (Recommended)

### Requirements

- Linux VPS (Ubuntu 22.04 recommended)
- 1 GB RAM minimum
- Node.js 18+
- MongoDB (can use MongoDB Atlas)

### Step 1: Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should be 18.x
npm --version
```

### Step 2: Clone Repository

```bash
git clone <repository-url> /opt/weather-bot
cd /opt/weather-bot
npm install
```

### Step 3: Configure Environment

```bash
cp .env.example .env
nano .env  # Edit with your configuration
```

**Important production settings**:
```bash
# Disable dry run for live trading
WEATHER_DRY_RUN=false

# Use production MongoDB
MONGO_URI='mongodb+srv://...'

# Discord notifications for monitoring
DISCORD_NOTIFICATIONS_ENABLED=true
```

### Step 4: Build

```bash
npm run build
```

### Step 5: Create Systemd Service

```bash
sudo nano /etc/systemd/system/weather-bot.service
```

```ini
[Unit]
Description=Polymarket Weather Trading Bot
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/weather-bot
ExecStart=/usr/bin/node /opt/weather-bot/dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### Step 6: Start Service

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable on boot
sudo systemctl enable weather-bot

# Start the service
sudo systemctl start weather-bot

# Check status
sudo systemctl status weather-bot
```

### Step 7: View Logs

```bash
# Real-time logs
sudo journalctl -u weather-bot -f

# Last 100 lines
sudo journalctl -u weather-bot -n 100
```

---

## Docker Deployment

### Dockerfile

Create `Dockerfile` in project root:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
```

### Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'
services:
  weather-bot:
    build: .
    restart: always
    env_file:
      - .env
    environment:
      - NODE_ENV=production
```

### Run with Docker

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

---

## MongoDB Setup

### Option 1: MongoDB Atlas (Recommended)

1. Create account at [mongodb.com](https://mongodb.com)
2. Create a free M0 cluster
3. Add your IP to whitelist (or 0.0.0.0/0 for VPS)
4. Create database user
5. Get connection string

```bash
MONGO_URI='mongodb+srv://username:password@cluster.mongodb.net/polymarket_weather'
```

### Option 2: Self-Hosted MongoDB

```bash
# Install MongoDB
sudo apt install -y mongodb

# Start service
sudo systemctl start mongodb
sudo systemctl enable mongodb

# Connection string
MONGO_URI='mongodb://localhost:27017/polymarket_weather'
```

---

## RPC Endpoint Setup

### Infura (Free Tier)

1. Create account at [infura.io](https://infura.io)
2. Create new project
3. Select Polygon network
4. Copy endpoint URL

```bash
RPC_URL='https://polygon-mainnet.infura.io/v3/YOUR_PROJECT_ID'
```

### Alchemy (Alternative)

1. Create account at [alchemy.com](https://alchemy.com)
2. Create new app on Polygon
3. Copy API key

```bash
RPC_URL='https://polygon-mainnet.g.alchemy.com/v2/YOUR_API_KEY'
```

---

## Discord Bot Setup

### Create Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers)
2. Click "New Application"
3. Name it (e.g., "Weather Bot")
4. Go to "Bot" section
5. Click "Add Bot"
6. Copy the token

### Get IDs

```bash
DISCORD_BOT_TOKEN='your_bot_token_here'
DISCORD_CLIENT_ID='your_app_client_id'
DISCORD_GUILD_ID='your_server_id'  # Right-click server → Copy ID
```

### Invite Bot to Server

1. Go to OAuth2 → URL Generator
2. Select scopes: `bot`, `applications.commands`
3. Select permissions: `Send Messages`, `Embed Links`
4. Copy and open the generated URL

---

## Monitoring & Alerting

### Discord Webhook Notifications

Enable in `.env`:
```bash
DISCORD_NOTIFICATIONS_ENABLED=true
DISCORD_WEBHOOK_URL='https://discord.com/api/webhooks/...'
```

You'll receive notifications for:
- Bot startup
- Trade executions
- Stop-loss/take-profit triggers
- Errors

### Log Monitoring

The bot writes logs to `logs/` directory:
- `logs/bot-YYYY-MM-DD.log`

Set up log rotation:
```bash
sudo nano /etc/logrotate.d/weather-bot
```

```
/opt/weather-bot/logs/*.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
}
```

---

## Security Best Practices

### 1. Never Commit Secrets

Ensure `.env` is in `.gitignore`:
```
.env
```

### 2. Restrict File Permissions

```bash
chmod 600 /opt/weather-bot/.env
```

### 3. Use Separate Wallet

Don't use your main wallet. Create a dedicated wallet for the bot.

### 4. Limit Wallet Balance

Only fund what you're willing to risk.

### 5. Firewall Rules

```bash
# Allow only necessary ports
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

---

## Updating the Bot

### Manual Update

```bash
cd /opt/weather-bot
git pull
npm install
npm run build
sudo systemctl restart weather-bot
```

### Automated Update Script

Create `update.sh`:
```bash
#!/bin/bash
cd /opt/weather-bot
git pull
npm install
npm run build
sudo systemctl restart weather-bot
echo "Update complete!"
```

```bash
chmod +x update.sh
./update.sh
```

---

## Troubleshooting

### Bot not starting

```bash
# Check logs
sudo journalctl -u weather-bot -n 50

# Common issues:
# - Missing .env file
# - Invalid MongoDB URI
# - Node.js not found
```

### Connection errors

```bash
# Test MongoDB
mongosh "your_connection_string"

# Test RPC
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  YOUR_RPC_URL
```

### High memory usage

Increase swap space:
```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## Production Checklist

- [ ] `.env` configured with production values
- [ ] `WEATHER_DRY_RUN=false` for live trading
- [ ] MongoDB connected and accessible
- [ ] RPC endpoint working
- [ ] Wallet funded with USDC
- [ ] Discord notifications enabled
- [ ] Systemd service created and enabled
- [ ] Logs being written
- [ ] Firewall configured
- [ ] Backup strategy for database
