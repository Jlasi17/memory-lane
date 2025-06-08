import requests
import os
from dotenv import load_dotenv

load_dotenv()

class LlamaIntegration:
    def __init__(self):
        self.groq_api_key = os.getenv("GROQ_API_KEY1")
        self.base_url = "https://api.groq.com/openai/v1/chat/completions"
    
    def generate_response(self, prompt, max_tokens=512, temperature=0.7):
        if not self.groq_api_key:
            raise ValueError("Missing Groq API key")
        
        headers = {
            "Authorization": f"Bearer {self.groq_api_key}",
            "Content-Type": "application/json"
        }
        
        data = {
            "model": "llama-3.3-70b-versatile",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": temperature
        }
        
        try:
            response = requests.post(self.base_url, json=data, headers=headers)
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"].strip()
        except Exception as e:
            raise Exception(f"Error generating response: {str(e)}")