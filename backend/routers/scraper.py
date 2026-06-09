from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
import requests
import os
import time
import hashlib
import json

router = APIRouter()

APIFY_TOKEN = os.environ.get("APIFY_TOKEN", "")
ACTOR_ID = "fRSgBvgbsRB4o7t30"

# ===== КЕШ =====
CACHE = {}  # key -> {"data": [...], "city": "...", "timestamp": float, "run_id": str}
CACHE_TTL = 6 * 3600  # 6 часов
CACHE_MAX_SIZE = 200  # макс. кол-во кешированных запросов

def make_cache_key(bbox, categories, enrich):
    """Округляем bbox до 4 знаков (~10м) для устойчивости к мелким сдвигам."""
    parts = [float(x) for x in bbox.split(",")]
    rounded = ",".join([str(round(p, 4)) for p in parts])
    cats = ",".join(sorted(categories))
    raw = rounded + "|" + cats + "|" + str(enrich)
    return hashlib.md5(raw.encode()).hexdigest()

def cleanup_cache():
    """Удаляем старые записи если кеш переполнен."""
    global CACHE
    if len(CACHE) > CACHE_MAX_SIZE:
        # Удаляем самые старые
        sorted_keys = sorted(CACHE.keys(), key=lambda k: CACHE[k]["timestamp"])
        for k in sorted_keys[:50]:
            del CACHE[k]

class ScrapeRequest(BaseModel):
    bbox: str
    categories: list
    max_results: int = 100
    enrich_data: bool = False

CATEGORY_QUERIES = {
    "Еда": ["кафе"],
    "Здоровье": ["аптеки"],
    "Шопинг": ["магазины"],
    "Красота": ["салоны красоты"],
    "Спорт": ["фитнес"],
    "Образование": ["школы"],
    "Досуг": ["развлечения"],
    "Авто": ["автосервисы"],
    "Финансы": ["банки"],
    "Услуги": ["услуги"],
    "Госучреждения": ["администрация"]
}

def reverse_geocode(lat, lon):
    try:
        r = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lon, "format": "json", "accept-language": "ru", "zoom": 10},
            headers={"User-Agent": "QuarterPortrait/1.0"}, timeout=8
        )
        if r.status_code == 200:
            addr = r.json().get("address", {})
            return addr.get("city") or addr.get("town") or addr.get("village") or addr.get("state", "")
    except:
        pass
    return ""

from services.subscription import is_pro_user, get_user_id_from_token

@router.post("/scrape/start")
async def start_scrape(req: ScrapeRequest, authorization: str = Header(default="")):
    if not APIFY_TOKEN:
        raise HTTPException(status_code=500, detail="APIFY_TOKEN not set")
    
    # Проверяем PRO статус (на этапе разработки — пропускаем, чтобы тестить)
    # token = authorization.replace("Bearer ", "")
    # user_id = get_user_id_from_token(token)
    # if not is_pro_user(user_id):
    #     raise HTTPException(status_code=403, detail="PRO_REQUIRED")

    # 1. ПРОВЕРКА КЕША
    cache_key = make_cache_key(req.bbox, req.categories, req.enrich_data)
    if cache_key in CACHE:
        cached = CACHE[cache_key]
        age = time.time() - cached["timestamp"]
        if age < CACHE_TTL:
            print("CACHE HIT for key " + cache_key[:8] + " (age " + str(int(age)) + "s)")
            return {
                "run_id": "cached_" + cache_key,
                "status": "CACHED",
                "detected_city": cached.get("city", ""),
                "from_cache": True,
                "cache_age_min": int(age / 60)
            }

    # 2. ЗАПУСК НОВОГО ПАРСИНГА
    try:
        south, west, north, east = [float(x) for x in req.bbox.split(",")]
    except:
        raise HTTPException(status_code=400, detail="Bad bbox")
    center_lat = (south + north) / 2
    center_lon = (west + east) / 2
    span_lat = abs(north - south)
    span_lon = abs(east - west)
    city = reverse_geocode(center_lat, center_lon) or "Москва"
    queries = []
    for cat in req.categories:
        if cat in CATEGORY_QUERIES:
            for q in CATEGORY_QUERIES[cat]:
                queries.append(q + " " + city)
    if not queries:
        raise HTTPException(status_code=400, detail="No categories")
    queries = list(dict.fromkeys(queries))[:5]
    safe_limit = 60 if req.enrich_data else 100
    actor_input = {
        "query": queries, "location": city,
        "coordinates": str(center_lon) + "," + str(center_lat),
        "viewportSpan": str(span_lon) + "," + str(span_lat),
        "maxResults": min(req.max_results, safe_limit),
        "language": "ru", "includeReviews": False,
        "maxPhotos": 0, "maxPosts": 0,
        "enrichBusinessData": bool(req.enrich_data)
    }
    response = requests.post(
        "https://api.apify.com/v2/acts/" + ACTOR_ID + "/runs",
        params={"token": APIFY_TOKEN}, json=actor_input, timeout=35
    )
    if response.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Apify: " + response.text[:300])
    run_data = response.json().get("data", {})

    # Сохраняем связку run_id -> cache_key
    run_id = run_data.get("id")
    if run_id:
        CACHE["__pending_" + run_id] = {
            "cache_key": cache_key,
            "city": city,
            "timestamp": time.time()
        }

    return {
        "run_id": run_id,
        "status": run_data.get("status"),
        "detected_city": city,
        "from_cache": False
    }

@router.get("/scrape/status/{run_id}")
async def check_status(run_id: str):
    if not APIFY_TOKEN:
        raise HTTPException(status_code=500, detail="APIFY_TOKEN not set")

    # === Если результат из кеша ===
    if run_id.startswith("cached_"):
        cache_key = run_id.replace("cached_", "")
        if cache_key in CACHE:
            cached = CACHE[cache_key]
            return {
                "status": "SUCCEEDED",
                "run_id": run_id,
                "data": cached["data"],
                "total": len(cached["data"]),
                "with_summary": len([x for x in cached["data"] if x.get("ai_summary")]),
                "from_cache": True
            }
        return {"status": "FAILED", "run_id": run_id}

    # === Запрос реального run ===
    resp = requests.get(
        "https://api.apify.com/v2/actor-runs/" + run_id,
        params={"token": APIFY_TOKEN}, timeout=20
    )
    data = resp.json().get("data", {})
    result = {"status": data.get("status"), "run_id": run_id}

    if data.get("status") == "SUCCEEDED" and data.get("defaultDatasetId"):
        items_resp = requests.get(
            "https://api.apify.com/v2/datasets/" + data["defaultDatasetId"] + "/items",
            params={"token": APIFY_TOKEN, "format": "json", "limit": 300}, timeout=40
        )
        if items_resp.status_code == 200:
            items = items_resp.json()
            aggregated = []
            for item in items:
                ai_summary = ""
                if isinstance(item.get("aiReviewSummary"), str):
                    ai_summary = item["aiReviewSummary"][:400]
                elif isinstance(item.get("reviewsSummary"), str):
                    ai_summary = item["reviewsSummary"][:400]
                aggregated.append({
                    "name": item.get("title") or item.get("name", ""),
                    "category": item.get("categoryName") or item.get("category", ""),
                    "rating": item.get("rating") or item.get("totalScore", 0),
                    "reviews_count": item.get("reviewCount") or item.get("reviewsCount", 0),
                    "address": str(item.get("address", ""))[:150],
                    "lat": item.get("latitude"), "lon": item.get("longitude"),
                    "ai_summary": ai_summary
                })
            aggregated = [x for x in aggregated if x["name"]]
            result["data"] = aggregated
            result["total"] = len(aggregated)
            result["with_summary"] = len([x for x in aggregated if x["ai_summary"]])

            # === СОХРАНЯЕМ В КЕШ ===
            pending_key = "__pending_" + run_id
            if pending_key in CACHE:
                cache_key = CACHE[pending_key]["cache_key"]
                city = CACHE[pending_key]["city"]
                CACHE[cache_key] = {
                    "data": aggregated,
                    "city": city,
                    "timestamp": time.time(),
                    "run_id": run_id
                }
                del CACHE[pending_key]
                cleanup_cache()
                print("CACHED key " + cache_key[:8] + ", " + str(len(aggregated)) + " items")

    return result

@router.get("/scrape/cache/stats")
async def cache_stats():
    """Статистика кеша (для отладки)"""
    valid = [k for k in CACHE if not k.startswith("__")]
    return {
        "total_entries": len(valid),
        "max_size": CACHE_MAX_SIZE,
        "ttl_hours": CACHE_TTL // 3600
    }
