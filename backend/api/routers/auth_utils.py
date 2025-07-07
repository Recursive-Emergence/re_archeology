import json
import os

ADMINS_FILE = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../users/admins.json'))

_admins_cache = None

# Read admin emails from environment variable ADMIN_EMAILS (comma-separated)
def get_admin_emails():
    env_admins = os.getenv('ADMIN_EMAILS')
    if env_admins:
        return set(email.strip().lower() for email in env_admins.split(','))
    
    global _admins_cache
    if _admins_cache is not None:
        return _admins_cache
    try:
        with open(ADMINS_FILE, 'r') as f:
            data = json.load(f)
            _admins_cache = set(email.lower() for email in data.get('admins', []))
            return _admins_cache
    except Exception:
        return set()

def is_admin_user(email: str) -> bool:
    if not email:
        return False
    return email.lower() in get_admin_emails()
