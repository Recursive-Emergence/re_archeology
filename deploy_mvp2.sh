#!/bin/bash

# MVP2 Docker-based Deployment Script for RE-Archaeology Framework
# This script sets up the production environment using Docker containers

set -e  # Exit on any error

echo "🚀 Starting RE-Archaeology MVP2 Docker Deployment"
echo "================================================="

# Configuration
PROJECT_NAME="re-archaeology"
PROJECT_DIR="$(pwd)"
DOCKER_COMPOSE_FILE="docker-compose.yml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    print_error "Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Check if running in project directory
if [ ! -f "requirements.txt" ] || [ ! -d "backend" ] || [ ! -d "frontend" ]; then
    print_error "Please run this script from the RE-Archaeology project root directory"
    exit 1
fi

# Configuration variables
SERVICE_USER="${USER:-re-arch}"
DOMAIN="${DOMAIN:-localhost}"
SSL_EMAIL="${SSL_EMAIL:-admin@localhost}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/re-archaeology}"

# Create necessary directories
print_status "Creating project directories..."
mkdir -p data/neo4j data/neo4j-logs data/redis data/uploads logs config

# Create data directories for Docker volumes
sudo mkdir -p $PROJECT_DIR/data/neo4j
sudo mkdir -p $PROJECT_DIR/data/neo4j-logs  
sudo mkdir -p $PROJECT_DIR/data/redis
sudo mkdir -p $PROJECT_DIR/logs
sudo mkdir -p $PROJECT_DIR/config
sudo mkdir -p $BACKUP_DIR

# Set proper permissions
sudo chown -R $USER:$USER $PROJECT_DIR/data
sudo chown -R $USER:$USER $PROJECT_DIR/logs
sudo chown -R $USER:$USER $PROJECT_DIR/config

# Set up Neo4j using Docker
print_status "Setting up Neo4j database..."
cat > $PROJECT_DIR/docker-compose.yml << EOF
version: '3.8'

services:
  neo4j:
    image: neo4j:5.13-community
    container_name: re-arch-neo4j
    restart: unless-stopped
    ports:
      - "7474:7474"
      - "7687:7687"
    volumes:
      - $PROJECT_DIR/data/neo4j:/data
      - $PROJECT_DIR/data/neo4j-logs:/logs
    environment:
      - NEO4J_AUTH=neo4j/your_secure_password_here
      - NEO4J_PLUGINS=["apoc"]
      - NEO4J_dbms_security_procedures_unrestricted=apoc.*
      - NEO4J_dbms_memory_heap_initial__size=512m
      - NEO4J_dbms_memory_heap_max__size=2G
    networks:
      - re-arch-network

  redis:
    image: redis:7-alpine
    container_name: re-arch-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - $PROJECT_DIR/data/redis:/data
    command: redis-server --appendonly yes --requirepass your_redis_password_here
    networks:
      - re-arch-network

networks:
  re-arch-network:
    driver: bridge
EOF

chown $SERVICE_USER:$SERVICE_USER $PROJECT_DIR/docker-compose.yml

# Start Docker services
print_status "Starting Docker services..."
cd $PROJECT_DIR
sudo -u $SERVICE_USER docker-compose up -d
cd -

# Wait for services to start
print_status "Waiting for services to start..."
sleep 30

# Create production environment file
print_status "Creating production environment configuration..."
cat > $PROJECT_DIR/app/.env << EOF
# Production Environment Configuration for MVP2

# Application Settings
PROJECT_NAME="RE-Archaeology Framework"
ENVIRONMENT=production
DEBUG=False
API_V1_STR="/api/v1"

# Database Configuration
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_secure_password_here

# Redis Configuration
REDIS_URL=redis://:your_redis_password_here@localhost:6379/0

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_REDIRECT_URI=https://$DOMAIN/auth/callback

# JWT Configuration
JWT_SECRET_KEY=$(openssl rand -hex 32)
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=30
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-3.5-turbo
OPENAI_EMBEDDING_MODEL=text-embedding-ada-002
OPENAI_MAX_TOKENS=1000

# Earth Engine Configuration
GOOGLE_SERVICE_ACCOUNT_EMAIL=your_service_account@your_project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=$PROJECT_DIR/config/earth-engine-key.json

# WebSocket Configuration
WEBSOCKET_PING_INTERVAL=30
WEBSOCKET_PING_TIMEOUT=10
WEBSOCKET_MAX_CONNECTIONS=1000

# Security Settings
CORS_ORIGINS=["https://$DOMAIN"]
ALLOWED_HOSTS=["$DOMAIN", "localhost"]

# Logging Configuration
LOG_LEVEL=INFO
LOG_FILE=$PROJECT_DIR/logs/app.log

# Background Task Configuration
CELERY_BROKER_URL=redis://:your_redis_password_here@localhost:6379/1
CELERY_RESULT_BACKEND=redis://:your_redis_password_here@localhost:6379/2

# File Upload Configuration
UPLOAD_MAX_SIZE_MB=50
UPLOAD_DIR=$PROJECT_DIR/data/uploads

# Rate Limiting
RATE_LIMIT_REQUESTS_PER_MINUTE=60
RATE_LIMIT_BURST=10
EOF

chown $SERVICE_USER:$SERVICE_USER $PROJECT_DIR/app/.env
chmod 600 $PROJECT_DIR/app/.env

# Create Nginx configuration
print_status "Setting up Nginx configuration..."
cat > /etc/nginx/sites-available/$PROJECT_NAME << EOF
server {
    listen 80;
    server_name $DOMAIN;
    
    # Redirect HTTP to HTTPS
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN;
    
    # SSL Configuration (will be set up by Certbot)
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";
    
    # Rate limiting
    limit_req_zone \$binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone \$binary_remote_addr zone=ws:10m rate=5r/s;
    
    # Main application
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # API rate limiting
        limit_req zone=api burst=20 nodelay;
    }
    
    # WebSocket connections
    location /ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # WebSocket rate limiting
        limit_req zone=ws burst=10 nodelay;
        
        # WebSocket timeout settings
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
    
    # Static files
    location /static/ {
        alias $PROJECT_DIR/app/frontend/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    # Health check endpoint
    location /health {
        proxy_pass http://127.0.0.1:8000/health;
        access_log off;
    }
    
    # Logs
    access_log $PROJECT_DIR/logs/nginx_access.log;
    error_log $PROJECT_DIR/logs/nginx_error.log;
}
EOF

# Enable Nginx site
ln -sf /etc/nginx/sites-available/$PROJECT_NAME /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
nginx -t

# Create Supervisor configuration for the FastAPI app
print_status "Setting up Supervisor configuration..."
cat > /etc/supervisor/conf.d/$PROJECT_NAME.conf << EOF
[program:re-archaeology-api]
command=$PROJECT_DIR/venv/bin/uvicorn backend.api.main:app --host 0.0.0.0 --port 8000 --workers 4
directory=$PROJECT_DIR/app
user=$SERVICE_USER
autostart=true
autorestart=true
redirect_stderr=true
stdout_logfile=$PROJECT_DIR/logs/api.log
stdout_logfile_maxbytes=50MB
stdout_logfile_backups=5
environment=PATH="$PROJECT_DIR/venv/bin"

[program:re-archaeology-websocket]
command=$PROJECT_DIR/venv/bin/python -m backend.websockets.server
directory=$PROJECT_DIR/app
user=$SERVICE_USER
autostart=true
autorestart=true
redirect_stderr=true
stdout_logfile=$PROJECT_DIR/logs/websocket.log
stdout_logfile_maxbytes=50MB
stdout_logfile_backups=5
environment=PATH="$PROJECT_DIR/venv/bin"

[program:re-archaeology-tasks]
command=$PROJECT_DIR/venv/bin/celery -A backend.background_tasks.celery_app worker --loglevel=info
directory=$PROJECT_DIR/app
user=$SERVICE_USER
autostart=true
autorestart=true
redirect_stderr=true
stdout_logfile=$PROJECT_DIR/logs/tasks.log
stdout_logfile_maxbytes=50MB
stdout_logfile_backups=5
environment=PATH="$PROJECT_DIR/venv/bin"
EOF

# Create log rotation configuration
print_status "Setting up log rotation..."
cat > /etc/logrotate.d/$PROJECT_NAME << EOF
$PROJECT_DIR/logs/*.log {
    daily
    missingok
    rotate 52
    compress
    delaycompress
    notifempty
    copytruncate
    su $SERVICE_USER $SERVICE_USER
}
EOF

# Set up firewall
print_status "Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Create initialization script for database
print_status "Creating database initialization script..."
cat > $PROJECT_DIR/init_database.sh << EOF
#!/bin/bash
cd $PROJECT_DIR/app
source $PROJECT_DIR/venv/bin/activate

echo "Initializing Neo4j schema..."
python -c "from backend.models.neo4j_schema import create_schema; create_schema()"

echo "Creating default thread categories..."
python backend/scripts/init_thread_categories.py

echo "Creating sample background tasks..."
python backend/scripts/init_sample_tasks.py

echo "Database initialization complete!"
EOF

chmod +x $PROJECT_DIR/init_database.sh
chown $SERVICE_USER:$SERVICE_USER $PROJECT_DIR/init_database.sh

# Create backup script
print_status "Creating backup script..."
cat > $PROJECT_DIR/backup.sh << EOF
#!/bin/bash
BACKUP_DATE=\$(date +%Y%m%d_%H%M%S)
BACKUP_PATH=$BACKUP_DIR/backup_\$BACKUP_DATE

echo "Creating backup at \$BACKUP_PATH..."
mkdir -p \$BACKUP_PATH

# Backup Neo4j data
docker exec re-arch-neo4j neo4j-admin dump --database=neo4j --to=/tmp/neo4j_backup.dump
docker cp re-arch-neo4j:/tmp/neo4j_backup.dump \$BACKUP_PATH/

# Backup Redis data
docker exec re-arch-redis redis-cli --rdb /tmp/redis_backup.rdb
docker cp re-arch-redis:/tmp/redis_backup.rdb \$BACKUP_PATH/

# Backup application files
tar -czf \$BACKUP_PATH/app_backup.tar.gz -C $PROJECT_DIR app

# Backup configuration
cp $PROJECT_DIR/app/.env \$BACKUP_PATH/
cp $PROJECT_DIR/docker-compose.yml \$BACKUP_PATH/

echo "Backup completed: \$BACKUP_PATH"

# Clean up old backups (keep last 30 days)
find $BACKUP_DIR -type d -name "backup_*" -mtime +30 -exec rm -rf {} +
EOF

chmod +x $PROJECT_DIR/backup.sh
chown $SERVICE_USER:$SERVICE_USER $PROJECT_DIR/backup.sh

# Add backup to crontab
print_status "Setting up automated backups..."
(crontab -u $SERVICE_USER -l 2>/dev/null; echo "0 2 * * * $PROJECT_DIR/backup.sh") | crontab -u $SERVICE_USER -

# Start services
print_status "Starting services..."
systemctl enable redis-server
systemctl start redis-server
systemctl reload supervisor
supervisorctl reread
supervisorctl update
systemctl enable nginx
systemctl start nginx

# Initialize database (wait for services to be ready)
sleep 10
sudo -u $SERVICE_USER $PROJECT_DIR/init_database.sh

# Get SSL certificate
print_status "Setting up SSL certificate..."
certbot --nginx -d $DOMAIN --email $SSL_EMAIL --agree-tos --non-interactive

# Create monitoring script
print_status "Creating monitoring script..."
cat > $PROJECT_DIR/monitor.sh << EOF
#!/bin/bash
echo "=== RE-Archaeology MVP2 System Status ==="
echo
echo "Docker Services:"
docker ps --filter "name=re-arch" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo
echo "Supervisor Services:"
supervisorctl status
echo
echo "Nginx Status:"
systemctl is-active nginx
echo
echo "Disk Usage:"
df -h $PROJECT_DIR
echo
echo "Recent Logs (last 10 lines):"
tail -10 $PROJECT_DIR/logs/api.log
EOF

chmod +x $PROJECT_DIR/monitor.sh
chown $SERVICE_USER:$SERVICE_USER $PROJECT_DIR/monitor.sh

# Final status check
print_status "Performing final status check..."
sleep 5

echo
echo "🎉 MVP2 Deployment Complete!"
echo "=========================="
echo
echo "Application URL: https://$DOMAIN"
echo "Project Directory: $PROJECT_DIR"
echo "Service User: $SERVICE_USER"
echo
echo "Management Commands:"
echo "  Monitor status: sudo -u $SERVICE_USER $PROJECT_DIR/monitor.sh"
echo "  Create backup: sudo -u $SERVICE_USER $PROJECT_DIR/backup.sh"
echo "  View logs: sudo -u $SERVICE_USER tail -f $PROJECT_DIR/logs/api.log"
echo "  Restart services: sudo supervisorctl restart all"
echo
echo "Next Steps:"
echo "1. Update the domain name and SSL email in this script"
echo "2. Configure your Google OAuth credentials in .env"
echo "3. Add your OpenAI API key to .env"
echo "4. Set up Earth Engine service account key"
echo "5. Update database passwords in .env and docker-compose.yml"
echo "6. Test all functionality through the web interface"
echo
print_warning "Remember to secure your credentials and test all features!"

# Display current status
sudo -u $SERVICE_USER $PROJECT_DIR/monitor.sh
