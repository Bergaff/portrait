from fastapi import APIRouter
import requests

router = APIRouter()

@router.get("/search")
async def search_address(q: str):
    try:
        r = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": q,
                "format": "json",
                "limit": 5,
                "accept-language": "ru",
                "countrycodes": "ru,by,kz,uz,kg",
                "addressdetails": 1
            },
            headers={"User-Agent": "QuarterPortrait/1.0 (contact@example.com)"},
            timeout=10
        )
        if r.status_code == 200:
            results = []
            for item in r.json():
                results.append({
                    "display_name": item.get("display_name", ""),
                    "lat": float(item.get("lat", 0)),
                    "lon": float(item.get("lon", 0))
                })
            return {"results": results}
    except Exception as e:
        print("Geocode error: " + str(e))
    return {"results": []}

@router.get("/detect-city")
async def detect_city():
    try:
        r = requests.get("https://ipapi.co/json/", timeout=5)
        if r.status_code == 200:
            data = r.json()
            return {
                "city": data.get("city", "Москва"),
                "lat": float(data.get("latitude", 55.7558)),
                "lon": float(data.get("longitude", 37.6173))
            }
    except:
        pass
    return {"city": "Москва", "lat": 55.7558, "lon": 37.6173}
