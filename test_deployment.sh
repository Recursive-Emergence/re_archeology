#!/bin/bash

# Pre-deployment test script
# =========================

echo "🧪 Running pre-deployment tests..."

# Test 1: Check if required files exist
echo "📋 Checking required files..."
required_files=(
    "backend/api/main.py"
    "frontend/index.html"
    "frontend/mvp1.html"
    "requirements.txt"
    "Dockerfile"
    ".env"
)

for file in "${required_files[@]}"; do
    if [[ -f "$file" ]]; then
        echo "✅ $file exists"
    else
        echo "❌ $file is missing"
        exit 1
    fi
done

# Test 2: Check if Neo4j connection variables are set
echo "🔗 Checking Neo4j configuration..."
if grep -q "NEO4J_URI=neo4j+s://9ade235d.databases.neo4j.io" .env; then
    echo "✅ Neo4j URI configured for cloud"
else
    echo "❌ Neo4j URI not configured properly"
    exit 1
fi

# Test 3: Build the production Docker image locally
echo "🏗️  Testing Docker build..."
if docker build -f Dockerfile -t re-archaeology-test . > /dev/null 2>&1; then
    echo "✅ Docker build successful"
    
    # Clean up test image
    docker rmi re-archaeology-test > /dev/null 2>&1
else
    echo "❌ Docker build failed"
    exit 1
fi

# Test 4: Check gcloud authentication
echo "🔐 Checking gcloud authentication..."
if gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "@"; then
    echo "✅ gcloud authenticated"
else
    echo "❌ gcloud not authenticated. Run 'gcloud auth login'"
    exit 1
fi

echo ""
echo "🎉 All pre-deployment tests passed!"
echo "🚀 Ready to deploy to Cloud Run with: ./deploy_to_cloud_run.sh"
