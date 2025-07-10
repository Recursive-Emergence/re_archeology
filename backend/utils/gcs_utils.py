"""
General Google Cloud Storage (GCS) utility functions for uploads, downloads, and blob management.
"""
import os
from typing import Optional
from google.cloud import storage
from google.oauth2 import service_account
from google.api_core.exceptions import NotFound


# CDN/GCS public URL pattern for direct client access to task cache
GCS_TASK_TILE_URL_PATTERN = "https://storage.googleapis.com/re_archaeology/task_tiles/{task_id}/level_{level}/tile_{row}_{col}/subtile_{subtile_row}_{subtile_col}.json"


def get_gcs_client(credentials_path: Optional[str] = None, project_id: Optional[str] = None):
    """Get a GCS client using the given credentials and project."""
    if not credentials_path:
        credentials_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS', 'sage-striker-294302-b89a8b7e205b.json')
    if not project_id:
        project_id = os.getenv('GOOGLE_EE_PROJECT_ID', 'sage-striker-294302')
    if os.path.exists(credentials_path):
        credentials = service_account.Credentials.from_service_account_file(credentials_path)
        return storage.Client(credentials=credentials, project=project_id)
    else:
        return storage.Client(project=project_id)


def get_gcs_bucket(bucket_name: str, client=None):
    """Get a GCS bucket object."""
    if client is None:
        client = get_gcs_client()
    return client.bucket(bucket_name)


def upload_blob(bucket, blob_path: str, data: bytes, content_type: str = 'application/octet-stream', metadata: Optional[dict] = None):
    """Upload bytes to a GCS blob."""
    blob = bucket.blob(blob_path)
    blob.upload_from_string(data, content_type=content_type)
    if metadata:
        blob.metadata = metadata
        blob.patch()
    return blob


def download_blob(bucket, blob_path: str) -> Optional[bytes]:
    """Download bytes from a GCS blob."""
    blob = bucket.blob(blob_path)
    if not blob.exists():
        return None
    return blob.download_as_bytes()


def safe_download_blob(bucket, blob_path: str, logger=None) -> Optional[bytes]:
    """Download bytes from a GCS blob, handling NotFound (404) gracefully and logging as info.
    Always use a fresh blob object and do not set generation unless explicitly needed.
    """
    # Always use a fresh blob object, and do not set generation
    blob = bucket.blob(blob_path)
    try:
        if not blob.exists():
            if logger:
                logger.info(f"[GCS] Blob not found: {blob_path}")
            return None
        return blob.download_as_bytes()
    except NotFound:
        if logger:
            logger.info(f"[GCS] Blob not found (NotFound exception): {blob_path}")
        return None
    except Exception as e:
        if logger:
            logger.error(f"[GCS] Error downloading blob {blob_path}: {e}")
        raise


def blob_exists(bucket, blob_path: str) -> bool:
    """Check if a blob exists in the bucket."""
    blob = bucket.blob(blob_path)
    return blob.exists()


def list_blobs(bucket, prefix: str = ""):
    """List blobs in a bucket with a given prefix."""
    return list(bucket.list_blobs(prefix=prefix))


def delete_blob(bucket, blob_path: str):
    """Delete a blob from the bucket."""
    blob = bucket.blob(blob_path)
    blob.delete()
