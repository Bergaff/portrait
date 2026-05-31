from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import requests
import hashlib
import os

router = APIRouter()

SUPABASE_URL = "https://epjtzfhlyyrzmcjqqlyw.supabase.co"
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

MAILRU_CLIENT_ID = "019e459104e27d97893914d68e0920e4"
MAILRU_CLIENT_SECRET = os.environ.get("MAILRU_SECRET", "")

class AuthRequest(BaseModel):
    access_token: str

def create_or_login_supabase(email: str, uid: str, provider: str, first_name: str = "", last_name: str = ""):
    if not SUPABASE_SERVICE_KEY:
        raise HTTPException(status_code=500, detail="Server not configured (Missing SUPABASE_SERVICE_KEY)")

    # Генерируем надёжный пароль на основе ID пользователя
    temp_password = hashlib.sha256((uid + provider + SUPABASE_SERVICE_KEY).encode()).hexdigest()[:24]

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
                "provider": provider,
                "uid": uid,
                "first_name": first_name,
                "last_name": last_name
            }
        },
        timeout=10
    )

    # Если уже существует — обновляем пароль
    if create_resp.status_code not in (200, 201):
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

@router.post("/auth/yandex")
async def yandex_auth(req: AuthRequest):
    # Яндекс требует заголовок OAuth, а не Bearer
    r = requests.get(
        "https://login.yandex.ru/info?format=json",
        headers={"Authorization": f"OAuth {req.access_token}"},
        timeout=10
    )
    if r.status_code != 200:
        raise HTTPException(status_code=400, detail="Yandex API error: " + r.text)

    data = r.json()
    uid = str(data.get("id", ""))
    email = data.get("default_email") or f"yandex_{uid}@placeholder.local"

    return create_or_login_supabase(
        email=email, uid=uid, provider="yandex",
        first_name=data.get("first_name", ""), last_name=data.get("last_name", "")
    )

@router.post("/auth/mailru")
async def mailru_auth(req: AuthRequest):
    if not MAILRU_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="Server not configured (Missing MAILRU_SECRET)")

    # Если пришёл код (authorization code flow)
    if req.access_token.startswith("code_"):
        code = req.access_token.replace("code_", "")
        # НОВЫЙ endpoint для обмена кода на токен
        token_resp = requests.post(
            "https://oauth.mail.ru/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": MAILRU_CLIENT_ID,
                "client_secret": MAILRU_CLIENT_SECRET,
                "redirect_uri": "https://portrait-production-20c1.up.railway.app/"
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10
        )
        if token_resp.status_code != 200:
            raise HTTPException(status_code=400, detail="Mail.ru token exchange failed: " + token_resp.text)
        access_token = token_resp.json().get("access_token")
    else:
        access_token = req.access_token

    # НОВЫЙ способ получения данных пользователя через userinfo endpoint
    userinfo_resp = requests.get(
        "https://oauth.mail.ru/userinfo",
        params={"access_token": access_token},
        timeout=10
    )
    if userinfo_resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Mail.ru userinfo failed: " + userinfo_resp.text)
    
    user = userinfo_resp.json()
    uid = str(user.get("id", ""))
    email = user.get("email") or f"mailru_{uid}@placeholder.local"

    return create_or_login_supabase(
        email=email, uid=uid, provider="mailru",
        first_name=user.get("first_name", ""), last_name=user.get("last_name", "")
    )
