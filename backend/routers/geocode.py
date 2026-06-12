from fastapi import APIRouter
import requests
import os

router = APIRouter()

YANDEX_GEOCODER_KEY = os.environ.get("YANDEX_GEOCODER_KEY", "")

@router.get("/debug/geocoder")
async def debug_geocoder():
    """Проверка что ключ загружен и работает"""
    result = {
        "key_present": bool(YANDEX_GEOCODER_KEY),
        "key_length": len(YANDEX_GEOCODER_KEY) if YANDEX_GEOCODER_KEY else 0,
        "key_preview": (YANDEX_GEOCODER_KEY[:8] + "...") if YANDEX_GEOCODER_KEY else "MISSING"
    }
    if YANDEX_GEOCODER_KEY:
        try:
            r = requests.get(
                "https://geocode-maps.yandex.ru/1.x/",
                params={"apikey": YANDEX_GEOCODER_KEY, "geocode": "Москва Тверская", "format": "json"},
                timeout=8
            )
            result["status_code"] = r.status_code
            result["response_preview"] = r.text[:500]
        except Exception as e:
            result["error"] = str(e)
    return result

@router.get("/search")
async def search_address(q: str):
    if not q or len(q) < 2:
        return {"results": []}

    results = []
    debug_info = []

    # 1. ЯНДЕКС ГЕОКОДЕР (основной, лучший для РФ/СНГ)
    if YANDEX_GEOCODER_KEY:
        try:
            r = requests.get(
                "https://geocode-maps.yandex.ru/1.x/",
                params={
                    "apikey": YANDEX_GEOCODER_KEY,
                    "geocode": q,
                    "format": "json",
                    "results": 8,
                    "lang": "ru_RU"
                },
                timeout=8
            )
            debug_info.append("yandex_status=" + str(r.status_code))
            if r.status_code == 200:
                data = r.json()
                members = data.get("response", {}).get("GeoObjectCollection", {}).get("featureMember", [])
                debug_info.append("yandex_count=" + str(len(members)))
                for m in members:
                    obj = m.get("GeoObject", {})
                    name = obj.get("name", "")
                    desc = obj.get("description", "")
                    full = name + (", " + desc if desc else "")
                    pos = obj.get("Point", {}).get("pos", "")
                    if pos:
                        coords = pos.split(" ")
                        if len(coords) == 2:
                            results.append({
                                "display_name": full[:100],
                                "lat": float(coords[1]),
                                "lon": float(coords[0])
                            })
                if results:
                    return {"results": results, "source": "yandex"}
            else:
                print("YANDEX GEOCODER ERROR " + str(r.status_code) + ": " + r.text[:300])
        except Exception as e:
            print("YANDEX EXCEPTION:", str(e))
            debug_info.append("yandex_exc=" + str(e)[:50])
    else:
        debug_info.append("yandex_key_missing")

    # 2. PHOTON (Komoot) — fallback
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
                    results.append({"display_name": display[:100], "lat": float(coords[1]), "lon": float(coords[0])})
            if results:
                return {"results": results, "source": "photon", "debug": debug_info}
    except Exception as e:
        debug_info.append("photon_exc=" + str(e)[:50])

    # 3. NOMINATIM (OSM) — последний fallback
    try:
        r2 = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": q, "format": "json", "limit": 7, "accept-language": "ru"},
            headers={"User-Agent": "QuarterPortrait/1.0"},
            timeout=8
        )
        if r2.status_code == 200:
            for item in r2.json():
                results.append({
                    "display_name": (item.get("display_name", "") or "")[:100],
                    "lat": float(item.get("lat", 0)),
                    "lon": float(item.get("lon", 0))
                })
    except Exception as e:
        debug_info.append("nominatim_exc=" + str(e)[:50])

    return {"results": results, "source": "fallback", "debug": debug_info}
