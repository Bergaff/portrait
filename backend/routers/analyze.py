import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter()

class AnalysisRequest(BaseModel):
    lat: float
    lng: float
    radius: float = 500.0  # Радиус анализа в метрах

class POIItem(BaseModel):
    id: str
    name: str
    lat: float
    lng: float
    category: str
    address: Optional[str] = None

class AnalysisResponse(BaseModel):
    score: int
    total_pois: int
    categories_breakdown: dict
    items: List[POIItem]

def categorize_poi(tags: dict) -> str:
    """
    Интеллектуальная фильтрация объектов для исключения ошибок разметки OSM.
    Исключает ситуации, когда крупные ритейлеры (например, Магнит) ошибочно попадают в аптеки.
    """
    name_lower = tags.get("name", "").lower()
    amenity = tags.get("amenity", "").lower()
    shop = tags.get("shop", "").lower()
    
    # Списки приоритетных ключевых слов для крупных торговых сетей
    grocery_brands = ["магнит", "пятерочка", "дикси", "перекресток", "лента", "ашан", "окей", "верный", "ярче", "самокат"]
    pharmacy_brands = ["аптека", "ригла", "вита", "неофарм", "горздрав", "столички", "планета здоровья"]
    
    # 1. Приоритетная проверка по названию бренда
    if any(brand in name_lower for brand in grocery_brands):
        return "supermarkets"
    if any(brand in name_lower for brand in pharmacy_brands):
        return "pharmacies"
        
    # 2. Стандартная проверка по тегам OSM, если бренд не распознан явным образом
    if shop in ["supermarket", "convenience", "grocery"]:
        return "supermarkets"
    if amenity == "pharmacy" or shop == "chemist":
        return "pharmacies"
    if amenity in ["cafe", "restaurant", "fast_food", "bar"]:
        return "catering"
    if shop in ["clothes", "shoes", "mall", "department_store"]:
        return "retail"
        
    return "other"

@router.post("/", response_model=AnalysisResponse)
async def analyze_zone(payload: AnalysisRequest):
    # Динамическое формирование BBox (границ зоны) на основе координат и радиуса
    # Упрощенный перевод метров в градусы для опрашивания Overpass API
    deg_offset = payload.radius / 111000.0
    min_lat = payload.lat - deg_offset
    max_lat = payload.lat + deg_offset
    min_lng = payload.lng - deg_offset
    max_lng = payload.lng + deg_offset

    overpass_query = f"""
    [out:json][timeout:25];
    (
      node({min_lat},{min_lng},{max_lat},{max_lng});
      way({min_lat},{min_lng},{max_lat},{max_lng});
    );
    out center;
    """
    
    url = "https://overpass-api.de/api/interpreter"
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.post(url, data={"data": overpass_query})
            if response.status_code != 200:
                raise HTTPException(status_code=502, detail="Ошибка внешнего гео-провайдера Overpass API")
            
            osm_data = response.json()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Не удалось получить данные инфраструктуры: {str(e)}")

    parsed_items = []
    breakdown = {"supermarkets": 0, "pharmacies": 0, "catering": 0, "retail": 0, "other": 0}
    
    for element in osm_data.get("elements", []):
        tags = element.get("tags", {})
        if not tags:
            continue
            
        category = categorize_poi(tags)
        
        # Получение координат в зависимости от типа объекта (node или way)
        lat = element.get("lat") or element.get("center", {}).get("lat")
        lng = element.get("lon") or element.get("center", {}).get("lng")
        
        if lat is None or lng is None:
            continue
            
        name = tags.get("name", tags.get("brand", category.capitalize()))
        address = tags.get("addr:street", "")
        if address and tags.get("addr:housenumber", ""):
            address += f", {tags.get('addr:housenumber')}"

        parsed_items.append(POIItem(
            id=str(element.get("id")),
            name=name,
            lat=lat,
            lng=lng,
            category=category,
            address=address if address else None
        ))
        
        breakdown[category] += 1

    # Взвешенный расчет коммерческого скоринга локации (0-100 баллов)
    # Корректировка логики под требования квартальных зон (базовые 60-70 баллов при наличии инфраструктуры)
    base_score = 40
    if breakdown["supermarkets"] > 0: base_score += 20
    if breakdown["pharmacies"] > 0: base_score += 15
    if breakdown["catering"] > 0: base_score += 15
    if breakdown["retail"] > 0: base_score += 10
    
    final_score = min(100, max(0, base_score + (len(parsed_items) // 2)))

    return AnalysisResponse(
        score=final_score,
        total_pois=len(parsed_items),
        categories_breakdown=breakdown,
        items=parsed_items
    )
