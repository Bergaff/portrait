from fastapi import APIRouter
import requests

router = APIRouter()

@router.get("/search")
async def search_address(q: str):
    results = []
    
    # 1. Photon (Komoot) — основной геокодер
    try:
        r = requests.get(
            "https://photon.komoot.io/api/",
            params={"q": q, "limit": 7, "lang": "ru"},
            headers={"User-Agent": "QuarterPortrait/1.0"},
            timeout=8
        )
        if r.status_code == 200:
            for feature in r.json().get("features", []):
                props = feature.get("properties", {})
                coords = feature.get("geometry", {}).get("coordinates", [0, 0])
                name = props.get("name", "")
                city = props.get("city", props.get("county", ""))
                street = props.get("street", "")
                country = props.get("country", "")
                parts = [p for p in [name, street, city, country] if p]
                display = ", ".join(parts[:4])
                if display:
                    results.append({"display_name": display, "lat": float(coords[1]), "lon": float(coords[0])})
    except Exception as e:
        print("Photon error:", e)
    
    # 2. Nominatim — если Photon ничего не нашёл
    if not results:
        try:
            r2 = requests.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": q, "format": "json", "limit": 7, "accept-language": "ru"},
                headers={"User-Agent": "QuarterPortrait/1.0 contact@example.com"},
                timeout=8
            )
            if r2.status_code == 200:
                for item in r2.json():
                    results.append({
                        "display_name": (item.get("display_name", "") or "")[:100],
                        "lat": float(item.get("lat", 0)),
                        "lon": float(item.get("lon", 0))
                    })
        except Exception as e2:
            print("Nominatim error:", e2)

    # 3. Maps.me (LocationIQ) — последний fallback
    if not results:
        try:
            r3 = requests.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": q + ", Россия", "format": "json", "limit": 5, "accept-language": "ru"},
                headers={"User-Agent": "QuarterPortrait/1.0"},
                timeout=8
            )
            if r3.status_code == 200:
                for item in r3.json():
                    results.append({
                        "display_name": (item.get("display_name", "") or "")[:100],
                        "lat": float(item.get("lat", 0)),
                        "lon": float(item.get("lon", 0))
                    })
        except:
            pass

    return {"results": results}
