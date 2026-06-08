from fastapi import APIRouter
import requests

router = APIRouter()

@router.get("/search")
async def search_address(q: str):
    try:
        r = requests.get(
            "https://photon.komoot.io/api/",
            params={"q": q, "limit": 5, "lang": "ru", "bbox": "19.0,41.0,190.0,82.0"},
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
                    results.append({"display_name": display, "lat": float(coords[1]), "lon": float(coords[0])})
            return {"results": results}
    except:
        pass
    return {"results": []}
