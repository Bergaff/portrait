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
    enrich_data: bool = False  # AI-саммари отзывов

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
    "Услуги": ["услуги"]
}

def reverse_geocode(lat, lon):
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
            return addr.get("city") or addr.get("town") or addr.get("village") or addr.get("state", "")
    except:
        pass
    return ""

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
    span_lat = abs(north - south)
    span_lon = abs(east - west)

    city = reverse_geocode(center_lat, center_lon)
    location_str = city if city else "Москва"

    queries = []
    for cat in req.categories:
        if cat in CATEGORY_QUERIES:
            for q in CATEGORY_QUERIES[cat]:
                queries.append(f"{q} {location_str}")

    if not queries:
        raise HTTPException(status_code=400, detail="Не выбрано ни одной категории")

    queries = list(dict.fromkeys(queries))[:5]

    # Лимит результатов: при enrich урезаем (дороже)
    safe_limit = 60 if req.enrich_data else 100

    actor_input = {
        "query": queries,
        "location": location_str,
        "coordinates": f"{center_lon},{center_lat}",
        "viewportSpan": f"{span_lon},{span_lat}",
        "maxResults": min(req.max_results, safe_limit),
        "language": "ru",
        "includeReviews": False,  # сами отзывы не нужны, только AI-саммари
        "maxPhotos": 0,
        "maxPosts": 0,
        "enrichBusinessData": bool(req.enrich_data)  # ⭐ ключевая опция
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
        "enriched": req.enrich_data
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
                    # AI-саммари из enrichment (структура может варьироваться)
                    ai_summary = ""
                    if isinstance(item.get("aiReviewSummary"), str):
                        ai_summary = item["aiReviewSummary"][:400]
                    elif isinstance(item.get("reviewsSummary"), str):
                        ai_summary = item["reviewsSummary"][:400]
                    elif isinstance(item.get("summary"), str):
                        ai_summary = item["summary"][:400]

                    aggregated.append({
                        "name": item.get("title") or item.get("name", ""),
                        "category": item.get("categoryName") or item.get("category", ""),
                        "rating": item.get("rating") or item.get("totalScore", 0),
                        "reviews_count": item.get("reviewCount") or item.get("reviewsCount", 0),
                        "address": str(item.get("address", ""))[:150],
                        "lat": item.get("latitude"),
                        "lon": item.get("longitude"),
                        "url": item.get("url", ""),
                        "ai_summary": ai_summary,
                        "sentiment": item.get("sentimentScore", 0)
                    })
                aggregated = [x for x in aggregated if x["name"]]
                result["data"] = aggregated
                result["total"] = len(aggregated)
                result["with_summary"] = len([x for x in aggregated if x["ai_summary"]])

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
