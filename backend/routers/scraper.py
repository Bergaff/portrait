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
    "Еда": ["рестораны", "кафе", "пиццерии", "кофейни"],
    "Здоровье": ["аптеки", "клиники", "стоматологии", "медицинские центры"],
    "Шопинг": ["магазины одежды", "супермаркеты", "торговые центры"],
    "Красота": ["салоны красоты", "парикмахерские", "барбершопы", "ногти"],
    "Спорт": ["фитнес", "тренажерные залы", "бассейны"],
    "Образование": ["школы", "детские сады"],
    "Досуг": ["кинотеатры", "театры", "парки"],
    "Авто": ["автосервисы", "автомойки"],
    "Финансы": ["банки", "банкоматы"],
    "Услуги": ["химчистки", "почта"]
}

@router.post("/scrape/start")
async def start_scrape(req: ScrapeRequest):
    if not APIFY_TOKEN:
        raise HTTPException(status_code=500, detail="APIFY_TOKEN не настроен")

    parts = [float(x) for x in req.bbox.split(",")]
    south, west, north, east = parts
    center_lat = (south + north) / 2
    center_lon = (west + east) / 2

    # Собираем запросы
    queries = []
    for cat in req.categories:
        if cat in CATEGORY_QUERIES:
            queries.extend(CATEGORY_QUERIES[cat])

    if not queries:
        raise HTTPException(status_code=400, detail="Не выбрано ни одной категории")

    queries = queries[:6]  # уменьшили, чтобы не тратить слишком много

    actor_input = {
        "searchStringsArray": queries,
        "maxItems": min(req.max_results, 80),
        "language": "ru",
        "includeReviews": bool(req.include_reviews),
        "maxPhotosPerPlace": 0,
        "maxPostsPerPlace": 0,
        "coordinates": f"{center_lat},{center_lon}",   # ← Строка!
        "viewportSpan": f"{abs(north-south)},{abs(east-west)}"  # ← Строка!
    }

    try:
        response = requests.post(
            f"https://api.apify.com/v2/acts/{ACTOR_ID}/runs",
            params={"token": APIFY_TOKEN},
            json=actor_input,
            timeout=30
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Connection error: {str(e)[:150]}")

    if response.status_code not in (200, 201):
        detail = response.text[:500]
        raise HTTPException(
            status_code=500, 
            detail=f"Apify error {response.status_code}: {detail}"
        )

    run_data = response.json().get("data", {})
    return {
        "run_id": run_data.get("id"),
        "status": run_data.get("status", "UNKNOWN"),
        "dataset_id": run_data.get("defaultDatasetId")
    }


# === Остальные эндпоинты (status и abort) ===
@router.get("/scrape/status/{run_id}")
async def check_status(run_id: str):
    if not APIFY_TOKEN:
        raise HTTPException(status_code=500, detail="APIFY_TOKEN не настроен")

    try:
        resp = requests.get(
            f"https://api.apify.com/v2/actor-runs/{run_id}",
            params={"token": APIFY_TOKEN},
            timeout=15
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
                params={"token": APIFY_TOKEN, "format": "json", "limit": 150},
                timeout=30
            )
            if items_resp.status_code == 200:
                items = items_resp.json()
                aggregated = [({
                    "name": item.get("title") or item.get("name", ""),
                    "category": item.get("categoryName") or item.get("category", ""),
                    "rating": item.get("totalScore") or item.get("rating", 0),
                    "reviews_count": item.get("reviewsCount") or 0,
                    "address": str(item.get("address", ""))[:100]
                }) for item in items if item.get("title") or item.get("name")]
                
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
