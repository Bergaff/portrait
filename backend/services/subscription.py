"""
Проверка платного статуса пользователя.
Пока возвращает True для всех — заглушка для будущего интегрирования.
"""
import os
import requests

SUPABASE_URL = "https://epjtzfhlyyrzmcjqqlyw.supabase.co"
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# ===== VIP / PRO ДОСТУП =====
# Обычные PRO-юзеры (можно временные / платные)
PRO_USERS = set([
    # "user_id_здесь",
])

# VIP-аккаунты с ПОЖИЗНЕННЫМ доступом (никогда не истекает)
# Сюда можно добавлять как user_id из Supabase, так и email
VIP_LIFETIME_USERS = set([
    "PTL010012@proton.me",   # замени на свой email
    # "your_supabase_user_id",
])

def is_vip_user(user_id: str = None, email: str = None) -> bool:
    """Пожизненный VIP-доступ (по id или email)."""
    if user_id and user_id in VIP_LIFETIME_USERS:
        return True
    if email and email.lower() in {x.lower() for x in VIP_LIFETIME_USERS}:
        return True
    return False

def is_pro_user(user_id: str = None, email: str = None) -> bool:
    """
    Проверяет PRO-доступ. VIP всегда считается PRO (пожизненно).
    """
    if is_vip_user(user_id, email):
        return True
    if user_id and user_id in PRO_USERS:
        return True
    return False

def get_user_id_from_token(token: str) -> str:
    """Извлекает user_id из Supabase JWT токена."""
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
