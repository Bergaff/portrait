from fastapi import APIRouter
from pydantic import BaseModel
from services.nvidia_ai import ask_nvidia

router = APIRouter()

class ReportRequest(BaseModel):
    org_text: str
    scores: dict
    scraped_data: list = []

@router.post("/report")
async def generate_report(req: ReportRequest):
    s = req.scores
    p = "Ты урбанист. Краткий портрет квартала на русском, без воды.\\n"
    p += "Индекс: " + str(s.get("overall","?")) + "/100. "
    p += "Еда:" + str(s.get("food","?")) + " Здоровье:" + str(s.get("health","?")) + " "
    p += "Шопинг:" + str(s.get("shopping","?")) + " Спорт:" + str(s.get("sport","?")) + " "
    p += "Образование:" + str(s.get("education","?")) + " Досуг:" + str(s.get("entertainment","?")) + "\\n"
    p += "Площадь: " + str(s.get("area_km2","?")) + " км², мест: " + str(s.get("total_places","?")) + "\\n"
    p += "Топ организаций:\\n" + req.org_text[:1500] + "\\n\\n"

    # Добавляем данные с Яндекс.Карт если есть
    if req.scraped_data:
        p += "\\n=== ДАННЫЕ С ЯНДЕКС.КАРТ (рейтинги и отзывы) ===\\n"
        sorted_data = sorted(req.scraped_data, key=lambda x: x.get("reviews_count", 0), reverse=True)
        for item in sorted_data[:25]:
            name = item.get("name", "")[:50]
            rating = item.get("rating", 0)
            reviews = item.get("reviews_count", 0)
            cat = item.get("category", "")[:30]
            if rating and reviews:
                p += f"- {name} ({cat}): ★{rating}, {reviews} отзывов\\n"

        # Считаем средние показатели
        ratings = [x.get("rating", 0) for x in req.scraped_data if x.get("rating", 0) > 0]
        avg_rating = round(sum(ratings) / len(ratings), 2) if ratings else 0
        total_reviews = sum(x.get("reviews_count", 0) for x in req.scraped_data)
        p += f"\\nСредний рейтинг района: {avg_rating}/5, всего отзывов: {total_reviews}\\n"
        p += "ОБЯЗАТЕЛЬНО учти эти рейтинги и количество отзывов в анализе!\\n\\n"

    p += "Напиши КРАТКО (3-4 предложения на раздел):\\n"
    p += "## Характер квартала\\n"
    p += "## Еда и досуг\\n"
    p += "## Шопинг и сервисы\\n"
    p += "## Плюсы и минусы\\n"
    if req.scraped_data:
        p += "## Анализ репутации (на основе отзывов)\\n"
    p += "## Идеи для бизнеса"

    result = ask_nvidia(p)
    return {"report": result}
