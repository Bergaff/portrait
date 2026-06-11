from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import requests
import os
import time
import hashlib
from urllib.parse import quote

router = APIRouter()

APIFY_TOKEN = os.environ.get("APIFY_TOKEN", "")
ACTOR_ID = "fRSgBvgbsRB4o7t30"

# КЕШ
CACHE = {}
CACHE_TTL = 6 * 3600
CACHE_MAX_SIZE = 200

def make_cache_key(bbox, categories, enrich):
    parts = [float(x) for x in bbox.split(",")]
    rounded = ",".join([str(round(p, 4)) for p in parts])
    cats = ",".join(sorted(categories))
    raw = rounded + "|" + cats + "|" + str(enrich)
    return hashlib.md5(raw.encode()).hexdigest()

def cleanup_cache():
    global CACHE
    if len(CACHE) > CACHE_MAX_SIZE:
        sorted_keys = sorted(CACHE.keys(), key=lambda k: CACHE[k].get("timestamp", 0))
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

def build_yandex_search_urls(queries, center_lat, center_lon, span_lat, span_lon):
    """
    Строим прямые URL поиска Яндекс.Карт с точными координатами области.
    Это работает намного точнее, чем location + coordinates.
    """
    urls = []
    # Подбираем zoom по размеру span (примерно)
    if max(span_lat, span_lon) > 0.05:
        zoom = 14
    elif max(span_lat, span_lon) > 0.02:
        zoom = 15
    elif max(span_lat, span_lon) > 0.01:
        zoom = 16
    else:
        zoom = 17

    for q in queries:
        url = (
            "https://yandex.ru/maps/?text=" + quote(q) +
            "&ll=" + str(center_lon) + "%2C" + str(center_lat) +
            "&z=" + str(zoom) +
            "&spn=" + str(span_lon) + "%2C" + str(span_lat)
        )
        urls.append({"url": url})
    return urls

@router.post("/scrape/start")
async def start_scrape(req: ScrapeRequest):
    if not APIFY_TOKEN:
        raise HTTPException(status_code=500, detail="APIFY_TOKEN not set")

    # КЕШ
    cache_key = make_cache_key(req.bbox, req.categories, req.enrich_data)
    if cache_key in CACHE:
        cached = CACHE[cache_key]
        age = time.time() - cached.get("timestamp", 0)
        if age < CACHE_TTL:
            print("CACHE HIT " + cache_key[:8])
            return {
                "run_id": "cached_" + cache_key,
                "status": "CACHED",
                "detected_city": cached.get("city", ""),
                "from_cache": True,
                "cache_age_min": int(age / 60)
            }

    try:
        south, west, north, east = [float(x) for x in req.bbox.split(",")]
    except:
        raise HTTPException(status_code=400, detail="Bad bbox")

    center_lat = (south + north) / 2
    center_lon = (west + east) / 2
    # СУЖАЕМ span - актор всё равно "размывает" поиск, лучше дать жёстче
    span_lat = abs(north - south) * 0.8
    span_lon = abs(east - west) * 0.8

    city = reverse_geocode(center_lat, center_lon) or ""

    # Формируем запросы (БЕЗ названия города! город уже задан координатами)
    queries = []
    for cat in req.categories:
        if cat in CATEGORY_QUERIES:
            queries.extend(CATEGORY_QUERIES[cat])
    if not queries:
        raise HTTPException(status_code=400, detail="No categories")
    queries = list(dict.fromkeys(queries))[:4]  # макс 4 запроса (экономим)

    # СТРОИМ startUrls с координатами в URL Яндекса
    start_urls = build_yandex_search_urls(queries, center_lat, center_lon, span_lat, span_lon)

    safe_limit = 60 if req.enrich_data else 100

    actor_input = {
        "startUrls": start_urls,
        "maxResults": min(req.max_results, safe_limit),
        "language": "ru",
        "includeReviews": False,
        "maxPhotos": 0,
        "maxPosts": 0,
        "enrichBusinessData": bool(req.enrich_data)
    }

    print("APIFY INPUT:", actor_input)

    response = requests.post(
        "https://api.apify.com/v2/acts/" + ACTOR_ID + "/runs",
        params={"token": APIFY_TOKEN}, json=actor_input, timeout=35
    )
    if response.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Apify: " + response.text[:300])

    run_data = response.json().get("data", {})
    run_id = run_data.get("id")

    # Сохраняем bbox для последующей фильтрации на бэкенде
    if run_id:
        CACHE["__pending_" + run_id] = {
            "cache_key": cache_key,
            "city": city,
            "bbox": req.bbox,
            "timestamp": time.time()
        }

    return {
        "run_id": run_id,
        "status": run_data.get("status"),
        "detected_city": city,
        "from_cache": False
    }

def is_inside_bbox(lat, lon, bbox_str):
    """Проверяем что точка внутри bbox"""
    try:
        south, west, north, east = [float(x) for x in bbox_str.split(",")]
        # Небольшой буфер 10% для пограничных точек
        buf_lat = (north - south) * 0.1
        buf_lon = (east - west) * 0.1
        return (south - buf_lat <= lat <= north + buf_lat and
                west - buf_lon <= lon <= east + buf_lon)
    except:
        return True

@router.get("/scrape/status/{run_id}")
async def check_status(run_id: str):
    if not APIFY_TOKEN:
        raise HTTPException(status_code=500, detail="APIFY_TOKEN not set")

    # Кеш
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

            # Получаем bbox из pending для фильтрации
            pending_key = "__pending_" + run_id
            bbox_filter = None
            if pending_key in CACHE:
                bbox_filter = CACHE[pending_key].get("bbox")

            aggregated = []
            outside_count = 0
            for item in items:
                ai_summary = ""
                if isinstance(item.get("aiReviewSummary"), str):
                    ai_summary = item["aiReviewSummary"][:400]
                elif isinstance(item.get("reviewsSummary"), str):
                    ai_summary = item["reviewsSummary"][:400]

                lat = item.get("latitude")
                lon = item.get("longitude")
                name = item.get("title") or item.get("name", "")
                if not name or not lat or not lon:
                    continue

                # БЭКЕНД-ФИЛЬТР: оставляем только внутри bbox
                if bbox_filter and not is_inside_bbox(lat, lon, bbox_filter):
                    outside_count += 1
                    continue

                aggregated.append({
                    "name": name,
                    "category": item.get("categoryName") or item.get("category", ""),
                    "rating": item.get("rating") or item.get("totalScore", 0),
                    "reviews_count": item.get("reviewCount") or item.get("reviewsCount", 0),
                    "address": str(item.get("address", ""))[:150],
                    "lat": lat,
                    "lon": lon,
                    "ai_summary": ai_summary
                })

            result["data"] = aggregated
            result["total"] = len(aggregated)
            result["filtered_out"] = outside_count
            result["with_summary"] = len([x for x in aggregated if x["ai_summary"]])

            # Сохраняем в кеш
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
                print("CACHED " + cache_key[:8] + ": " + str(len(aggregated)) + " items, " + str(outside_count) + " filtered out")

    return result

@router.get("/scrape/cache/stats")
async def cache_stats():
    valid = [k for k in CACHE if not k.startswith("__")]
    return {
        "total_entries": len(valid),
        "max_size": CACHE_MAX_SIZE,
        "ttl_hours": CACHE_TTL // 3600
    }
