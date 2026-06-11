import os
from openai import OpenAI

api_key = os.environ.get("NVIDIA_API_KEY", "")
nvidia_client = OpenAI(
    api_key=api_key,
    base_url="https://integrate.api.nvidia.com/v1",
    timeout=90.0  # увеличиваем таймаут до 90 сек
) if api_key else None

def ask_nvidia(prompt):
    if not nvidia_client:
        return "AI недоступен: ключ не настроен."
    try:
        r = nvidia_client.chat.completions.create(
            model="meta/llama-3.3-70b-instruct",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1500,
            temperature=0.6,
            timeout=90.0
        )
        return r.choices[0].message.content.strip()
    except Exception as e:
        return "AI недоступен: " + str(e)[:200]
