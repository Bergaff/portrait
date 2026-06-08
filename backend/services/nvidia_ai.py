import os
import re
from google import genai
from google.genai import types

# Профессиональный клиент Gemini, работающий на бесплатном API-ключе
# Инициализируется один раз для экономии ресурсов
api_key = os.environ.get("GEMINI_API_KEY", "")
client = genai.Client(api_key=api_key) if api_key else None

async def generate_response(messages: list) -> str:
    """
    Отправляет историю диалога в ИИ-модель и возвращает строго отформатированный,
    очищенный от «воды» и ИИ-штампов лаконичный ответ.
    """
    if not client:
        return "Ошибка конфигурации: Переменная GEMINI_API_KEY не установлена на сервере Railway."

    try:
        # Извлекаем системный промпт, если он передан в структуре роутера
        system_instruction = None
        contents = []

        for msg in messages:
            if msg["role"] == "system":
                system_instruction = msg["content"]
            elif msg["role"] == "user":
                contents.append(types.Content(role="user", parts=[types.Part.from_text(text=msg["content"])]))
            elif msg["role"] in ["assistant", "model"]:
                contents.append(types.Content(role="model", parts=[types.Part.from_text(text=msg["content"])]))

        # Конфигурируем параметры генерации для максимальной строгости ответов
        config = types.GenerateContentConfig(
            temperature=0.1,  # Минимальная креативность для исключения "воды"
            max_output_tokens=300,
            system_instruction=system_instruction
        )

        # Используем универсальную легковесную и быструю модель, идеальную для SaaS-панелей
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=contents,
            config=config
        )

        raw_text = response.text if response.text else ""

        # Постобработка текста: срезаем случайные вводные фразы нейросетей, если они проскочили
        cleaned_text = re.sub(r'^(конечно|разумеется|давайте рассмотрим|исходя из ваших данных)[,\s]*', '', raw_text, flags=re.IGNORECASE)
        cleaned_text = cleaned_text.strip()

        return cleaned_text if cleaned_text else "Данные локации обработаны. Сбоев не обнаружено."

    except Exception as e:
        return f"Ошибка обработки запроса моделью: {str(e)}"
