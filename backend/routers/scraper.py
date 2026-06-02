from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import requests
import os

router = APIRouter()

APIFY_TOKEN = os.environ.get("APIFY_TOKEN", "")
ACTOR_ID = "fRSgBvgbsRB4o7t30"

class ScrapeRequest(BaseModel):
    bbox: str
    categories: list
    max_results: int = 100
    include_reviews: bool = False

CATEGORY_QUERIES = {
    "Еда": ["кафе", "рестораны", "пиццерии", "кофейни"],
    "Здоровье": ["аптеки", "клиники", "стоматологии"],
    "Шопинг": ["магазины одежды", "супермаркеты"],
    "Красота": ["салоны красоты", "парикмахерские"],
    "Спорт": ["фитнес", "тренажерные залы"],
    "Образование": ["школы", "детские сады"],
    "Досуг": ["кинотеатры", "парки"],
    "Авто": ["автосервисы", "автомойки"],
    "Финансы": ["банки"],
    "Услуги": ["химчистки", "почта"]
}

def reverse_geocode(lat, lon):
    """Получаем название города по координатам через Nominatim"""
    try:
        r = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lon, "format": "json", "accept-language": "ru", "zoom": 10},
            headers={"User-Agent": "QuarterPortrait/1.0"},
            timeout=8
        )
        if r.status_code == 200:
            data = r.json()
            addr = data.get("address", {})
            city = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("state", "")
            country = addr.get("country", "")
            return city, country
    except:
        pass
    return "", ""

@router.post("/scrape/start")
async def start_scrape(req: ScrapeRequest):
    if not APIFY_TOKEN:
        raise HTTPException(status_code=500, detail="APIFY_TOKEN не настроен")

    try:
        south, west, north, east = [float(x) for x in req.bbox.split(",")]
    except:
        raise HTTPException(status_code=400, detail="Неверный bbox")

    center_lat = (south + north) / 2
    center_lon = (west + east) / 2
    span_lat = abs(north - south) * 0.9
    span_lon = abs(east - west) * 0.9

    # Определяем город по координатам
    city, country = reverse_geocode(center_lat, center_lon)
    location_str = f"{city}, {country}" if city and country else (city or country or "Россия")

    # Собираем запросы и добавляем город к каждому
    queries = []
    for cat in req.categories:
        if cat in CATEGORY_QUERIES:
            for q in CATEGORY_QUERIES[cat]:
                # Добавляем город к запросу для надёжности
                if city:
                    queries.append(f"{q} {city}")
                else:
                    queries.append(q)

    if not queries:
        raise HTTPException(status_code=400, detail="Не выбрано ни одной категории")

    # Уникальные запросы, максимум 5 чтобы не сливать бюджет
    queries = list(dict.fromkeys(queries))[:5]

    # ⚠️ ПРАВИЛЬНЫЕ имена полей для этого актора
    actor_input = {
        "searchStringsArray": queries,
        "locationQuery": location_str,
        "coordinates": f"{center_lat},{center_lon}",
        "viewportSpan": f"{span_lat},{span_lon}",
        "maxItems": min(req.max_results, 100),
        "language": "ru",
        "includeReviews": bool(req.include_reviews),
        "maxPhotosPerPlace": 0,
        "maxPostsPerPlace": 0
    }

    try:
        response = requests.post(
            f"https://api.apify.com/v2/acts/{ACTOR_ID}/runs",
            params={"token": APIFY_TOKEN},
            json=actor_input,
            timeout=35
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Connection error: {str(e)[:150]}")

    if response.status_code not in (200, 201):
        raise HTTPException(
            status_code=500,
            detail=f"Apify error {response.status_code}: {response.text[:600]}"
        )

    run_data = response.json().get("data", {})
    return {
        "run_id": run_data.get("id"),
        "status": run_data.get("status", "UNKNOWN"),
        "dataset_id": run_data.get("defaultDatasetId"),
        "detected_city": city,
        "queries_used": queries
    }


@router.get("/scrape/status/{run_id}")
async def check_status(run_id: str):
    if not APIFY_TOKEN:
        raise HTTPException(status_code=500, detail="APIFY_TOKEN не настроен")

    try:
        resp = requests.get(
            f"https://api.apify.com/v2/actor-runs/{run_id}",
            params={"token": APIFY_TOKEN},
            timeout=20
        )
        data = resp.json().get("data", {})

        result = {
            "status": data.get("status"),
            "run_id": run_id,
            "started_at": data.get("startedAt"),
            "finished_at": data.get("finishedAt")
        }

        if data.get("status") == "SUCCEEDED" and data.get("defaultDatasetId"):
            items_resp = requests.get(
                f"https://api.apify.com/v2/datasets/{data['defaultDatasetId']}/items",
                params={"token": APIFY_TOKEN, "format": "json", "limit": 300},
                timeout=40
            )
            if items_resp.status_code == 200:
                items = items_resp.json()
                aggregated = []
                for item in items:
                    aggregated.append({
                        "name": item.get("title") or item.get("name", ""),
                        "category": item.get("categoryName") or item.get("category", ""),
                        "rating": item.get("totalScore") or item.get("rating", 0),
                        "reviews_count": item.get("reviewsCount") or item.get("reviewCount", 0),
                        "address": str(item.get("address", ""))[:150],
                        "lat": item.get("latitude"),
                        "lon": item.get("longitude"),
                        "url": item.get("url", "")
                    })
                aggregated = [x for x in aggregated if x["name"]]
                result["data"] = aggregated
                result["total"] = len(aggregated)

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:200])


@router.post("/scrape/abort/{run_id}")
async def abort_run(run_id: str):
    if not APIFY_TOKEN:
        return {"status": "error"}
    try:
        requests.post(
            f"https://api.apify.com/v2/actor-runs/{run_id}/abort",
            params={"token": APIFY_TOKEN}
        )
        return {"status": "aborted"}
    except:
        return {"status": "error"}
