from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import requests
import hashlib
import os
import hmac

router = APIRouter()

MAILRU_CLIENT_ID = "019e459104e27d97893914d68e0920e4"
MAILRU_CLIENT_SECRET = os.environ.get("MAILRU_SECRET", "")
SUPABASE_URL = "https://epjtzfhlyyrzmcjqqlyw.supabase.co"
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

class MailruRequest(BaseModel):
    access_token: str

def get_mailru_user(access_token):
    params = {
        "method": "users.getInfo",
        "app_id": MAILRU_CLIENT_ID,
        "session_key": access_token,
        "secure": "1"
    }
    sorted_keys = sorted(params.keys())
    sig_str = "".join([k + "=" + params[k] for k in sorted_keys]) + MAILRU_CLIENT_SECRET
    params["sig"] = hashlib.md5(sig_str.encode()).hexdigest()

    r = requests.get("https://www.appsmail.ru/platform/api", params=params, timeout=10)
    if r.status_code != 200:
        raise HTTPException(status_code=400, detail="Mail.ru API error")
    data = r.json()
    if not isinstance(data, list) or len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty Mail.ru response")
    return data[0]

@router.post("/auth/mailru")
async def mailru_auth(req: MailruRequest):
    if not MAILRU_CLIENT_SECRET or not SUPABASE_SERVICE_KEY:
        raise HTTPException(status_code=500, detail="Server not configured")

    user = get_mailru_user(req.access_token)
    uid = user.get("uid", "")
    email = user.get("email") or ("mailru_" + uid + "@placeholder.local")

    # Детерминированный пароль на основе uid + secret
    temp_password = hashlib.sha256((uid + MAILRU_CLIENT_SECRET).encode()).hexdigest()[:24]

    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": "Bearer " + SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json"
    }

    # Пытаемся создать пользователя
    create_resp = requests.post(
        SUPABASE_URL + "/auth/v1/admin/users",
        headers=headers,
        json={
            "email": email,
            "password": temp_password,
            "email_confirm": True,
            "user_metadata": {
                "provider": "mailru",
                "mailru_uid": uid,
                "first_name": user.get("first_name", ""),
                "last_name": user.get("last_name", "")
            }
        },
        timeout=10
    )

    # Если уже есть (409/422) - обновляем пароль через admin
    if create_resp.status_code not in (200, 201):
        # Находим пользователя по email
        list_resp = requests.get(
            SUPABASE_URL + "/auth/v1/admin/users?email=" + email,
            headers=headers, timeout=10
        )
        users = list_resp.json().get("users", []) if list_resp.status_code == 200 else []
        if users:
            user_id = users[0]["id"]
            requests.put(
                SUPABASE_URL + "/auth/v1/admin/users/" + user_id,
                headers=headers,
                json={"password": temp_password},
                timeout=10
            )

    return {"email": email, "temp_password": temp_password}
