# EC2 Deployment Guide

## 1. Launch an EC2 Instance

- AMI: Amazon Linux 2023 or Ubuntu 22.04
- Instance type: `t3.micro` is plenty for this
- Security group: allow SSH (port 22) from your IP only
- No need to open any other ports — the bot uses outbound polling, not webhooks

## 2. SSH into the Instance

```bash
ssh -i your-key.pem ec2-user@<your-ec2-ip>
```

(Use `ubuntu` instead of `ec2-user` if you picked Ubuntu.)

## 3. Install Node.js

```bash
# Amazon Linux 2023
sudo yum install -y nodejs npm git

# Ubuntu
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

## 4. Install MongoDB

Option A — Install locally on the instance:

```bash
# Amazon Linux 2023
sudo tee /etc/yum.repos.d/mongodb-org-7.0.repo <<EOF
[mongodb-org-7.0]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/amazon/2023/mongodb-org/7.0/x86_64/
gpgcheck=1
enabled=1
gpgkey=https://pgp.mongodb.com/server-7.0.asc
EOF
sudo yum install -y mongodb-org
sudo systemctl start mongod
sudo systemctl enable mongod
```

Option B — Use MongoDB Atlas (free tier):
- Create a cluster at https://cloud.mongodb.com
- Get the connection string and use it as MONGODB_URI

## 5. Clone and Set Up the Bot

```bash
git clone <your-repo-url> paydora-support-bot
cd paydora-support-bot
npm install
```

## 6. Create the .env File

```bash
cat > .env <<EOF
BOT_TOKEN=your_bot_token_here
AGENT_GROUP_ID=-1003875315567
MONGODB_URI=mongodb://localhost:27017/paydora-support
ADMIN_USER_IDS=7679142062
EOF
```

Replace the values with your actual credentials.

## 7. Install PM2 and Start the Bot

PM2 keeps the bot running and restarts it if it crashes or the server reboots.

```bash
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

The last command prints a sudo command — copy and run it. This makes PM2 start on boot.

## 8. Useful PM2 Commands

```bash
pm2 status          # check if bot is running
pm2 logs            # view bot output
pm2 restart all     # restart after code changes
pm2 stop all        # stop the bot
```

## 9. Updating the Bot

```bash
cd paydora-support-bot
git pull
npm install
pm2 restart all
```
