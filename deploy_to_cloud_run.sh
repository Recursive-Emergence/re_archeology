#!/bin/bash

# RE-Archaeology Framework - Cloud Run Deployment Script
# ======================================================

set -e  # Exit on any error

# Load environment variables from .env file
if [ -f .env ]; then
    echo "📋 Loading environment variables from .env file..."
    export $(grep -v '^#' .env | grep -v '^$' | xargs)
else
    echo "❌ Error: .env file not found. Please create one with your actual credentials"
    echo "   Copy .env.example to .env and fill in your values"
    exit 1
fi

# Configuration
PROJECT_ID="sage-striker-294302"
REGION="us-central1"
SERVICE_NAME="re-archaeology-framework"
IMAGE_TAG="latest"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:${IMAGE_TAG}"

echo "🚀 Starting deployment to Google Cloud Run..."
echo "================================================"
echo "Project ID: ${PROJECT_ID}"
echo "Region: ${REGION}"
echo "Service Name: ${SERVICE_NAME}"
echo "Image Tag: ${IMAGE_TAG}"
echo "Full Image Name: ${IMAGE_NAME}"
echo "Port: 8080 (Cloud Run standard)"
echo ""
echo "⚠️  Note: Make sure you're authenticated with 'gcloud auth login'"
echo ""

# Check if gcloud is installed and authenticated
if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud CLI is not installed. Please install it first."
    echo "   Visit: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if user is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "@"; then
    echo "❌ Error: Not authenticated with gcloud. Please run 'gcloud auth login'"
    exit 1
fi

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Error: Docker is not running. Please start Docker first."
    exit 1
fi

# Set the project
echo "📋 Setting GCP project..."
gcloud config set project ${PROJECT_ID}

# Enable required APIs
echo "🔧 Enabling required APIs..."
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com

# Check if we should rebuild or reuse existing image
if [ "$1" = "--rebuild" ] || [ "$1" = "-r" ]; then
    echo "🔄 Rebuild flag detected, will build new image..."
    SHOULD_REBUILD=true
else
    # Check if image already exists locally
    if docker image inspect ${IMAGE_NAME} >/dev/null 2>&1; then
        echo "📦 Found existing image: ${IMAGE_NAME}"
        echo "   Use --rebuild flag to force rebuilding"
        SHOULD_REBUILD=false
    else
        echo "🏗️  No existing image found, will build new one..."
        SHOULD_REBUILD=true
    fi
fi

# Clean up any previous builds (only if rebuilding)
if [ "$SHOULD_REBUILD" = true ]; then
    echo "🧹 Cleaning up previous builds..."
    docker system prune -f 2>/dev/null || true

    # Build the Docker image
    echo "🏗️  Building Docker image for production..."
    docker build -f Dockerfile -t ${IMAGE_NAME} . --no-cache --quiet
    
    echo "📤 Pushing image to Google Container Registry..."
    docker push ${IMAGE_NAME}
else
    echo "📤 Pushing existing image to Google Container Registry..."
    docker push ${IMAGE_NAME}
fi

# Deploy to Cloud Run - environment variables loaded from .env file in container
echo "☁️  Deploying to Cloud Run..."
echo "   📋 Environment variables will be loaded from .env file in container"
echo "   🔑 Google EE credentials will be loaded from JSON file in container"
gcloud run deploy ${SERVICE_NAME} \
    --image ${IMAGE_NAME} \
    --platform managed \
    --region ${REGION} \
    --allow-unauthenticated \
    --memory 1Gi \
    --cpu 1 \
    --timeout 3600 \
    --max-instances 10 \
    --port 8080

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
