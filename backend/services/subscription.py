import os
import requests
from fastapi import HTTPException

SUPABASE_URL = "https://epjtzfhlyyrzmcjqqlyw.supabase.co"
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

VIP_LIFETIME_USERS = set([
    "PTL010012@proton.me, tech@tim2030.by"
])

def is_vip_user(user_id: str = None, email: str = None) -> bool:
    if email:
        if email.lower() in {e.lower() for e in VIP_LIFETIME_USERS}:
            return True
    if user_id and user_id in VIP_LIFETIME_USERS:
        return True
    return False

def is_pro_user(user_id: str = None, email: str = None) -> bool:
    if is_vip_user(user_id, email):
        return True
    return False

def get_user_id_from_token(token: str) -> str:
    if not token or not SUPABASE_SERVICE_KEY:
        return ""
    try:
        r = requests.get(
            SUPABASE_URL + "/auth/v1/user",
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": "Bearer " + token
            }, timeout=5
        )
        if r.status_code == 200:
            return r.json().get("id", "")
    except:
        pass
    return ""
