"""
Script to recursively copy all files under data/ (not the top folder itself) to GCS bucket 're_archaeology'.
Preserves relative paths under the bucket, e.g. data/tasks/foo.json -> tasks/foo.json in GCS.
"""
import os
from pathlib import Path
import sys
sys.path.append(str(Path(__file__).parent.parent.parent))
from backend.utils.gcs_utils import get_gcs_bucket, upload_blob

BUCKET_NAME = "re_archaeology"
LOCAL_DATA_DIR = Path(__file__).parent.parent.parent / "data"

bucket = get_gcs_bucket(BUCKET_NAME)

def upload_dir(local_dir: Path, gcs_prefix: str = ""):
    for root, dirs, files in os.walk(local_dir):
        for file in files:
            local_path = Path(root) / file
            rel_path = local_path.relative_to(local_dir)
            gcs_path = str(Path(gcs_prefix) / rel_path).replace("\\", "/")
            with open(local_path, "rb") as f:
                data = f.read()
            # Guess content type
            if file.endswith(".json"):
                content_type = "application/json"
            elif file.endswith(".npy") or file.endswith(".npz"):
                content_type = "application/octet-stream"
            else:
                content_type = "application/octet-stream"
            print(f"Uploading {local_path} -> gs://{BUCKET_NAME}/{gcs_path}")
            upload_blob(bucket, gcs_path, data, content_type=content_type)

if __name__ == "__main__":
    # Copy everything under data/ (not the data/ folder itself)
    for child in LOCAL_DATA_DIR.iterdir():
        if child.is_dir() or child.is_file():
            upload_dir(child, gcs_prefix=child.name)
