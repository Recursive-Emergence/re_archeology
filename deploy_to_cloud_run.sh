#!/bin/bash

# RE-Archaeology Framework - Cloud Run Deployment Script
# ======================================================
# Updated to match current system configuration with start_server.py
#
# Requirements Strategy:
# - requirements.txt: Full development environment (~6GB)
# - requirements.cloudrun.txt: Minimal production environment (~2GB)
#   * Includes essential scipy for phi0_core.py
#   * Excludes heavy packages like pandas, matplotlib, geopandas
#   * Optimized for Cloud Run memory and startup time

set -e  # Exit on any error

# Configuration
PROJECT_ID="sage-striker-294302"
REGION="us-east1"
SERVICE_NAME="re-archaeology-framework"
IMAGE_TAG="latest"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:${IMAGE_TAG}"

# Validate required files exist
echo "🔍 Validating required files for deployment..."
REQUIRED_FILES=(
    "start_server.py"
    "backend/api/main.py"
    "Dockerfile"
    ".env.cloudrun"
    "requirements.cloudrun.txt"
    "sage-striker-294302-b89a8b7e205b.json"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ Error: Required file not found: $file"
        exit 1
    fi
done

# Check that kernel/ directory exists
if [ ! -d "kernel" ]; then
    echo "❌ Error: Required directory not found: kernel/"
    exit 1
fi

# Check that profiles/ directory exists
if [ ! -d "profiles" ]; then
    echo "❌ Error: Required directory not found: profiles/"
    exit 1
fi

echo "✅ All required files and directories found"

echo "🚀 Starting deployment to Google Cloud Run..."
echo "================================================"
echo "Project ID: ${PROJECT_ID}"
echo "Region: ${REGION}"
echo "Service Name: ${SERVICE_NAME}"
echo "Image Name: ${IMAGE_NAME}"
echo "Entry Point: start_server.py"
echo ""

# Check prerequisites
echo "🔧 Checking prerequisites..."

if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud CLI is not installed. Please install it first."
    echo "   Visit: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "@"; then
    echo "❌ Error: Not authenticated with gcloud. Please run 'gcloud auth login'"
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    echo "❌ Error: Docker is not running. Please start Docker first."
    exit 1
fi

echo "✅ All prerequisites met"

# Set the project and enable required APIs
echo "📋 Setting GCP project and enabling APIs..."
gcloud config set project ${PROJECT_ID}

gcloud services enable cloudbuild.googleapis.com --quiet
gcloud services enable run.googleapis.com --quiet
gcloud services enable containerregistry.googleapis.com --quiet

# Build and deploy strategy
SHOULD_REBUILD=false
if [ "$1" = "--rebuild" ] || [ "$1" = "-r" ]; then
    echo "🔄 Rebuild flag detected, will build new image..."
    SHOULD_REBUILD=true
elif ! docker image inspect ${IMAGE_NAME} >/dev/null 2>&1; then
    echo "🏗️  No existing image found, will build new one..."
    SHOULD_REBUILD=true
else
    echo "📦 Found existing image: ${IMAGE_NAME}"
    echo "   Use --rebuild flag to force rebuilding"
fi

if [ "$SHOULD_REBUILD" = true ]; then
    echo "🧹 Cleaning up previous builds..."
    docker system prune -f 2>/dev/null || true

    # Build the Docker image using optimized Cloud Run requirements
    echo "🏗️  Building Docker image with Cloud Run optimized dependencies..."
    echo "   📋 Using requirements.cloudrun.txt (includes scipy for phi0_core.py)"
    docker build -f Dockerfile -t ${IMAGE_NAME} . --no-cache

    echo "📤 Pushing image to Google Container Registry..."
    docker push ${IMAGE_NAME}
else
    echo "📤 Pushing existing image to Google Container Registry..."
    docker push ${IMAGE_NAME}
fi

# Deploy to Cloud Run with optimized configuration
echo "☁️  Deploying to Cloud Run..."
echo "   📋 Environment: .env.cloudrun (includes scipy-compatible config)"
echo "   🔑 Credentials: Google service account JSON"
echo "   🚀 Entry point: start_server.py"

gcloud run deploy ${SERVICE_NAME} \
    --image ${IMAGE_NAME} \
    --platform managed \
    --region ${REGION} \
    --allow-unauthenticated \
    --memory 2Gi \
    --cpu 2 \
    --timeout 3600 \
    --max-instances 10 \
    --port 8080 \
    --env-vars-file .env.cloudrun.yaml

# Get the service URL
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} --region=${REGION} --format="value(status.url)")

# Update the Google OAuth redirect URI with the actual service URL
echo "🔧 Updating Google OAuth redirect URI..."
gcloud run services update ${SERVICE_NAME} \
    --region=${REGION} \
    --set-env-vars "GOOGLE_REDIRECT_URI=${SERVICE_URL}/api/v1/auth/google/callback"

echo ""
echo "✅ Deployment completed successfully!"
echo "🌐 Service URL: ${SERVICE_URL}"
echo "📊 Health Check: ${SERVICE_URL}/health"
echo "📚 API Documentation: ${SERVICE_URL}/docs"
echo "🎯 Frontend: ${SERVICE_URL}/"
echo ""
echo "⚠️  IMPORTANT: Update your Google OAuth settings!"
echo "   1. Go to Google Cloud Console: https://console.cloud.google.com/apis/credentials"
echo "   2. Edit your OAuth 2.0 Client ID"
echo "   3. Add this URL to 'Authorized JavaScript origins': ${SERVICE_URL}"
echo "   4. Add this URL to 'Authorized redirect URIs': ${SERVICE_URL}/api/v1/auth/google/callback"
echo ""
echo "📋 Useful commands:"
echo "   View logs: gcloud run services logs read ${SERVICE_NAME} --region=${REGION}"
echo "   Update service: gcloud run services update ${SERVICE_NAME} --region=${REGION}"
echo "   Delete service: gcloud run services delete ${SERVICE_NAME} --region=${REGION}"
echo ""
echo "🎉 RE-Archaeology MVP is now live on Google Cloud Run!"
