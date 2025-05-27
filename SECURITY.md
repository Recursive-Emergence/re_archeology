# 🔐 Secure Credentials Management for RE-Archaeology MVP

## Google Cloud Authentication

### For Local Development:
```bash
# Install gcloud CLI and authenticate
gcloud auth login
gcloud config set project sage-striker-294302
```

### For Production Deployment:
Use one of these secure methods:

#### Option 1: Application Default Credentials (Recommended)
```bash
gcloud auth application-default login
```

#### Option 2: Service Account Key (If needed)
1. Download the service account key from Google Cloud Console
2. Set environment variable:
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your-service-account-key.json"
```

⚠️ **NEVER commit service account keys to git repositories!**

## Neo4j Cloud Credentials

The Neo4j Aura credentials are configured via environment variables:
- `NEO4J_URI=neo4j+s://9ade235d.databases.neo4j.io`
- `NEO4J_USER=neo4j`
- `NEO4J_PASSWORD=f1WMma2rOlQHPLCktIfb0mbXJMGs_6M87_1jMsQF49E`

### For Local Development:
Set these in your `.env` file (which is gitignored).

### For Cloud Run Deployment:
These are automatically set via the deployment script's `--set-env-vars` flags.

## Security Best Practices

1. ✅ **Use .gitignore** - All credential files are excluded
2. ✅ **Environment Variables** - Credentials passed via environment, not files
3. ✅ **Application Default Credentials** - Use gcloud auth for local development
4. ✅ **Cloud Run Service Account** - Production uses Cloud Run's built-in service account
5. ✅ **Least Privilege** - Service accounts have minimal required permissions

## Files That Should NEVER Be Committed:
- `.env` (contains actual secrets)
- `*-credentials.json` (service account keys)
- `gcp-credentials.json` (any GCP credential files)
- Any file containing passwords, API keys, or tokens
