from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict

router = APIRouter()

class ReportRequest(BaseModel):
    lat: float
    lng: float
    zone_score: int
    total_pois: int
    categories_breakdown: dict
    scraped_data: Optional[List[dict]] = None  # Подмешивание данных внешних парсеров (Apify/Yandex)

class ReportResponse(BaseModel):
    status: str
    summary_text: str
    recommendation: str
    metrics_log: dict

@router.post("/generate", response_model=ReportResponse)
async def generate_report(payload: ReportRequest):
    try:
        # Интеллектуальный анализ структуры для исключения ошибок ручной или автоматической разметки
        breakdown = payload.categories_breakdown
        
        # Корректировка потенциальных аномалий: если внешние scraped_data содержат продуктовые бренды,
        # проверяем, чтобы они увеличивали вес правильной категории
        if payload.scraped_data:
            for item in payload.scraped_data:
                name_lower = item.get("name", "").lower()
                if any(brand in name_lower for brand in ["магнит", "пятерочка", "дикси", "перекресток"]):
                    # Если объект был ошибочно посчитан в другую категорию, корректируем баланс
                    if "pharmacies" in breakdown and breakdown["pharmacies"] > 0 and "аптек" in name_lower:
                        pass # Это действительно аптека Магнит
                    else:
                        breakdown["supermarkets"] = breakdown.get("supermarkets", 0) + 1

        # Формирование лаконичного коммерческого заключения без лишней воды
        score = payload.zone_score
        if score >= 75:
            conclusion = "Локация обладает наивысшим торговым потенциалом. Высокая концентрация трафика при сбалансированном окружении."
            rec_text = "Рекомендуется немедленное развертывание коммерческих точек флагманского формата."
        elif score >= 55:
            conclusion = "Стабильная квартальная зона со сформированным спросом. Наблюдается умеренная конкурентная нагрузка."
            rec_text = "Рекомендуется открытие точек стандартного или дисконтного формата с фокусом на локальный трафик."
        else:
            conclusion = "Зона с низким или несбалансированным коммерческим потенциалом. Высокие риски окупаемости."
            rec_text = "Требуется детальный аудит пешеходных потоков перед принятием решения."

        return ReportResponse(
            status="generated",
            summary_text=f"Анализ гео-зоны ({payload.lat:.4f}, {payload.lng:.4f}). Итоговый коммерческий индекс: {score}/100. Общее число инфраструктурных объектов (POI): {payload.total_pois}.",
            recommendation=f"{conclusion} {rec_text}",
            metrics_log={
                "evaluated_score": score,
                "adjusted_supermarkets": breakdown.get("supermarkets", 0),
                "adjusted_pharmacies": breakdown.get("pharmacies", 0),
                "external_records_processed": len(payload.scraped_data) if payload.scraped_data else 0
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка при сборке коммерческого отчета: {str(e)}")
