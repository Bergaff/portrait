from fastapi import APIRouter
import requests

router = APIRouter()

@router.get("/search")
async def search_address(q: str):
    """
    Используем Photon - бесплатный геокодер без блокировок
    """
    try:
        r = requests.get(
            "https://photon.komoot.io/api/",
            params={
                "q": q,
                "limit": 5,
                "lang": "ru",
                "bbox": "19.0,41.0,190.0,82.0"
            },
            headers={"User-Agent": "QuarterPortrait/1.0"},
            timeout=10
        )
        if r.status_code == 200:
            data = r.json()
            results = []
            for feature in data.get("features", []):
                props = feature.get("properties", {})
                coords = feature.get("geometry", {}).get("coordinates", [0, 0])
                name = props.get("name", "")
                city = props.get("city", props.get("county", ""))
                street = props.get("street", "")
                country = props.get("country", "")
                parts = [p for p in [name, street, city, country] if p]
                display = ", ".join(parts[:3])
                if display:
                    results.append({
                        "display_name": display,
                        "lat": float(coords[1]),
                        "lon": float(coords[0])
                    })
            return {"results": results}
    except Exception as e:
        print("Photon error: " + str(e))

    # Резервный вариант - Nominatim
    try:
        r2 = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": q, "format": "json", "limit": 5, "accept-language": "ru"},
            headers={"User-Agent": "QuarterPortrait/1.0/contact@portrait.app"},
            timeout=8
        )
        if r2.status_code == 200:
            results = []
            for item in r2.json():
                results.append({
                    "display_name": item.get("display_name", "")[:80],
                    "lat": float(item.get("lat", 0)),
                    "lon": float(item.get("lon", 0))
                })
            return {"results": results}
    except Exception as e2:
        print("Nominatim fallback error: " + str(e2))

    return {"results": []}

@router.get("/detect-city")
async def detect_city():
    providers = [
        "https://ipapi.co/json/",
        "https://ip-api.com/json/?fields=city,lat,lon",
        "https://ipwho.is/"
    ]
    for url in providers:
        try:
            r = requests.get(url, timeout=5)
            if r.status_code == 200:
                data = r.json()
                city = data.get("city", data.get("City", "Москва"))
                lat = float(data.get("latitude", data.get("lat", 55.7558)))
                lon = float(data.get("longitude", data.get("lon", 37.6173)))
                if lat and lon:
                    return {"city": city, "lat": lat, "lon": lon}
        except:
            continue
    return {"city": "Москва", "lat": 55.7558, "lon": 37.6173}
