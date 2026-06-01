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

# Маппинг твоих категорий на поисковые запросы (на русском - лучше работает)
CATEGORY_QUERIES = {
    "Еда": ["рестораны", "кафе", "пиццерии"],
    "Здоровье": ["аптеки", "клиники", "стоматологии"],
    "Шопинг": ["магазины одежды", "супермаркеты", "торговые центры"],
    "Красота": ["салоны красоты", "парикмахерские", "барбершопы"],
    "Спорт": ["фитнес", "тренажерные залы", "бассейны"],
    "Образование": ["школы", "детские сады", "репетиторы"],
    "Досуг": ["кинотеатры", "театры", "парки развлечений"],
    "Авто": ["автосервисы", "автомойки", "шиномонтаж"],
    "Финансы": ["банки", "банкоматы"],
    "Услуги": ["химчистки", "ремонт обуви", "почта"]
}

@router.post("/scrape/start")
async def start_scrape(req: ScrapeRequest):
    if not APIFY_TOKEN:
        raise HTTPException(status_code=500, detail="APIFY_TOKEN не настроен в Railway")

    # Парсим bbox: south,west,north,east
    parts = [float(x) for x in req.bbox.split(",")]
    south, west, north, east = parts
    center_lat = (south + north) / 2
    center_lon = (west + east) / 2

    # Рассчитываем viewport span (грубо)
    span_lat = abs(north - south)
    span_lng = abs(east - west)

    # Формируем поисковые запросы из выбранных категорий
    queries = []
    for cat in req.categories:
        if cat in CATEGORY_QUERIES:
            queries.extend(CATEGORY_QUERIES[cat])

    if not queries:
        raise HTTPException(status_code=400, detail="Не выбрано ни одной категории")

    # Ограничиваем количество запросов (каждый запрос = деньги)
    queries = queries[:8]  # максимум 8 запросов

    # Формируем input для актора (на основе твоего описания)
    actor_input = {
        "searchStringsArray": queries,
        "maxItems": min(req.max_results, 100),  # жёсткий лимит 100
        "language": "ru",
        "includeReviews": bool(req.include_reviews),
        "maxPhotosPerPlace": 0,
        "maxPostsPerPlace": 0,
        # Precise area через координаты
        "coordinates": {
            "lat": center_lat,
            "lng": center_lon
        },
        "viewportSpan": {
            "lat": span_lat,
            "lng": span_lng
        }
    }

    try:
        response = requests.post(
            f"https://api.apify.com/v2/acts/{ACTOR_ID}/runs",
            params={"token": APIFY_TOKEN},
            json=actor_input,
            timeout=20
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Connection error: {str(e)[:100]}")

    if response.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail=f"Apify error {response.status_code}: {response.text[:200]}")

    run_data = response.json().get("data", {})
    return {
        "run_id": run_data.get("id"),
        "status": run_data.get("status"),
        "dataset_id": run_data.get("defaultDatasetId")
    }

@router.get("/scrape/status/{run_id}")
async def check_status(run_id: str):
    if not APIFY_TOKEN:
        raise HTTPException(status_code=500, detail="APIFY_TOKEN не настроен")

    try:
        response = requests.get(
            f"https://api.apify.com/v2/actor-runs/{run_id}",
            params={"token": APIFY_TOKEN},
            timeout=10
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Connection error: {str(e)[:100]}")

    if response.status_code != 200:
        raise HTTPException(status_code=500, detail=f"Status check failed: {response.text[:200]}")

    data = response.json().get("data", {})
    status = data.get("status")
    dataset_id = data.get("defaultDatasetId")

    result = {
        "status": status,
        "run_id": run_id,
        "started_at": data.get("startedAt"),
        "finished_at": data.get("finishedAt")
    }

    # Если успешно — забираем результаты
    if status == "SUCCEEDED" and dataset_id:
        try:
            items_resp = requests.get(
                f"https://api.apify.com/v2/datasets/{dataset_id}/items",
                params={"token": APIFY_TOKEN, "format": "json", "limit": 200},
                timeout=20
            )
            if items_resp.status_code == 200:
                items = items_resp.json()
                # Агрегируем (БЕЗ хранения сырых отзывов!)
                aggregated = []
                for item in items:
                    aggregated.append({
                        "name": item.get("title", item.get("name", "")),
                        "category": item.get("categoryName", item.get("category", "")),
                        "rating": item.get("totalScore", item.get("rating", 0)),
                        "reviews_count": item.get("reviewsCount", 0),
                        "address": item.get("address", "")[:80],
                        "phone": item.get("phone", ""),
                        "url": item.get("url", "")
                    })
                # Фильтруем мусор - оставляем только с названием
                aggregated = [x for x in aggregated if x["name"]]
                result["data"] = aggregated
                result["total"] = len(aggregated)
        except Exception as e:
            result["error"] = f"Failed to fetch items: {str(e)[:100]}"

    return result

@router.post("/scrape/abort/{run_id}")
async def abort_run(run_id: str):
    if not APIFY_TOKEN:
        raise HTTPException(status_code=500, detail="APIFY_TOKEN не настроен")
    try:
        response = requests.post(
            f"https://api.apify.com/v2/actor-runs/{run_id}/abort",
            params={"token": APIFY_TOKEN},
            timeout=10
        )
        return {"status": "aborted" if response.status_code == 200 else "error"}
    except:
        return {"status": "error"}
