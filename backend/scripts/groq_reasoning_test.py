"""Finds which setting hides Qwen's reasoning. Run: python scripts/groq_reasoning_test.py"""
import os
import time

from dotenv import load_dotenv
from groq import Groq

load_dotenv()
client = Groq(api_key=os.environ["GROQ_API_KEY"], timeout=60)
model = os.environ["GROQ_VISION_MODEL"]

variants = {
    "baseline": {},
    "reasoning_format=hidden": {"reasoning_format": "hidden"},
    "reasoning_effort=none": {"reasoning_effort": "none"},
    "reasoning_effort=low": {"reasoning_effort": "low"},
}

for name, extra in variants.items():
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "A photo shows a rusty pipe dripping water. Describe the problem in one sentence."}],
            max_completion_tokens=1500,
            **extra,
        )
        text = (resp.choices[0].message.content or "").strip().replace("\n", " ")
        print(f"[OK]   {name}: {resp.usage.completion_tokens} output tokens")
        print(f"       {text[:220]}\n")
    except Exception as exc:  # noqa: BLE001 - diagnostic script
        print(f"[FAIL] {name}: {type(exc).__name__}: {str(exc)[:200]}\n")
    time.sleep(2)