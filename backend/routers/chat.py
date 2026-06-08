from fastapi import APIRouter
from pydantic import BaseModel
from services.nvidia_ai import ask_nvidia

router = APIRouter()

class ChatRequest(BaseModel):
    question: str
    org_text: str
    scores: dict
    history: list = []

@router.post("/chat")
async def chat_answer(req: ChatRequest):
    question = req.question[:500]
    history_text = ""
    for msg in req.history[-6:]:
        role = "Пользователь" if msg.get("role") == "user" else "Ассистент"
        history_text += role + ": " + msg.get("content", "") + "\\n"
    p = "ПРАВИЛА: отвечай ТОЛЬКО про городскую среду, районы, бизнес, урбанистику. На русском.\\n"
    p += "Оценка района: " + str(req.scores.get("overall", "?")) + "/100\\n"
    p += "Организации:\\n" + req.org_text[:2000] + "\\n"
    if history_text:
        p += "История:\\n" + history_text + "\\n"
    p += "Вопрос: " + question + "\\nОтвет:"
    result = ask_nvidia(p)
    return {"answer": result}
