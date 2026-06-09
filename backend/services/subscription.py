"""
Проверка платного статуса пользователя.
Пока возвращает True для всех — заглушка для будущего интегрирования.
"""
import os
import requests

SUPABASE_URL = "https://epjtzfhlyyrzmcjqqlyw.supabase.co"
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# Временный белый список PRO юзеров (потом — таблица в Supabase)
PRO_USERS = set([
    # "user_id_здесь",
])

def is_pro_user(user_id: str = None) -> bool:
    """
    Проверяет, имеет ли пользователь PRO-доступ.
    На время разработки: True если user_id в whitelist, иначе False.
    Когда добавишь таблицу subscriptions в Supabase — запросишь оттуда.
    """
    if not user_id:
        return False
    if user_id in PRO_USERS:
        return True
    # TODO: запрос в Supabase таблицу subscriptions
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
