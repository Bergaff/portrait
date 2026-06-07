import httpx
from fastapi import APIRouter, Request

router = APIRouter()

# Список доверенных внешних гео-баз для определения города по IP
GEO_PROVIDERS = [
    "https://ipwho.is/{}",
    "https://ip-api.com/json/{}",
    "https://ipapi.co/{}/json/"
]

@router.get("/detect")
async def detect_city(request: Request):
    # Извлечение реального IP пользователя за прокси-сервером Railway
    forwarded_for = request.headers.get("x-forwarded-for")
    client_ip = forwarded_for.split(",")[0].strip() if forwarded_for else request.client.host
    
    # Дефолтный ответ (безопасный фолбек на случай VPN или отсутствия разрешений)
    fallback_response = {
        "status": "fallback",
        "city": "Москва",
        "lat": 55.7558,
        "lng": 37.6173,
        "note": "Определено по умолчанию или через защищенное соединение"
    }

    # Если IP локальный или служебный, сразу отдаем фолбек
    if client_ip in ("127.0.0.1", "localhost", "0.0.0.0") or client_ip.startswith("10.") or client_ip.startswith("192.168."):
        return fallback_response

    async with httpx.AsyncClient(timeout=3.0) as client:
        for provider in GEO_PROVIDERS:
            try:
                url = provider.format(client_ip)
                response = await client.get(url)
                if response.status_code == 200:
                    data = response.json()
                    
                    # Парсинг ответа в зависимости от структуры провайдера
                    city = data.get("city") or data.get("city_name")
                    lat = data.get("lat") or data.get("latitude")
                    lng = data.get("lon") or data.get("longitude") or data.get("lng")
                    
                    # Защита от ложного VPN-позиционирования
                    if city and lat and lng:
                        return {
                            "status": "success",
                            "city": city,
                            "lat": float(lat),
                            "lng": float(lng),
                            "ip_detected": client_ip
                        }
            except Exception:
                continue # Пробуем следующий провайдер, если текущий недоступен
                
    return fallback_response
