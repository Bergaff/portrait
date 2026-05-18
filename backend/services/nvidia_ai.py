from openai import OpenAI
import os
nvidia_client = OpenAI(
    api_key=os.environ.get("NVIDIA_API_KEY", ""),
    base_url="https://integrate.api.nvidia.com/v1"
)

def ask_nvidia(prompt):
    try:
        r = nvidia_client.chat.completions.create(
            model="meta/llama-3.3-70b-instruct",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2000,
            temperature=0.7
        )
        return r.choices[0].message.content.strip()
    except Exception as e:
        return "AI временно недоступен: " + str(e)[:100]
