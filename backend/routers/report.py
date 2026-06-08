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
    p = "Ты опытный городской эксперт. Пишешь живо, с конкретикой, без воды. На русском.\\n\\n"
    p += "=== РАЙОН ===\\n"
    p += "Индекс: " + str(s.get("overall","?")) + "/100\\n"
    p += "Площадь: " + str(s.get("area_km2","?")) + " км2, мест: " + str(s.get("total_places","?")) + "\\n"
    p += "Метрики: Еда " + str(s.get("food","?")) + ", Здоровье " + str(s.get("health","?"))
    p += ", Шопинг " + str(s.get("shopping","?")) + ", Спорт " + str(s.get("sport","?"))
    p += ", Образование " + str(s.get("education","?")) + ", Досуг " + str(s.get("entertainment","?")) + "\\n\\n"

    has_scraped = bool(req.scraped_data)
    has_summaries = any(x.get("ai_summary") for x in req.scraped_data) if has_scraped else False

    if has_scraped:
        sorted_data = sorted(req.scraped_data, key=lambda x: (x.get("reviews_count", 0) or 0), reverse=True)
        p += "=== ЗАВЕДЕНИЯ (Яндекс.Карты) ===\\n"
        for item in sorted_data[:20]:
            name = (item.get("name") or "")[:60]
            rating = item.get("rating", 0)
            reviews = item.get("reviews_count", 0)
            cat = (item.get("category") or "")[:30]
            summary = (item.get("ai_summary") or "").strip()
            if not name:
                continue
            line = "- " + name + " [" + cat + "] *" + str(rating) + " (" + str(reviews) + " отзывов)"
            if summary:
                line += "\\n  Отзывы: " + summary
            p += line + "\\n"
        ratings = [x.get("rating", 0) for x in req.scraped_data if x.get("rating", 0) > 0]
        if ratings:
            avg = round(sum(ratings) / len(ratings), 2)
            p += "\\nСредний рейтинг района: " + str(avg) + "/5\\n\\n"
    else:
        p += "=== ОРГАНИЗАЦИИ ===\\n" + req.org_text[:1500] + "\\n\\n"

    p += "Напиши КРАТКО (3-4 предложения на раздел):\\n"
    p += "## Характер квартала\\n"
    if has_scraped:
        p += "## Куда стоит сходить\\n## Куда лучше не ходить\\n"
    else:
        p += "## Еда и досуг\\n## Шопинг и сервисы\\n"
    p += "## Плюсы\\n## Минусы\\n"
    if has_summaries:
        p += "## О чём говорят жители\\n"
    p += "## Идеи для бизнеса"

    result = ask_nvidia(p)
    return {"report": result}
