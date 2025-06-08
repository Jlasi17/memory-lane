from datetime import datetime
import re
import random
from typing import List, Dict
from .emotion_model import EmotionClassifier
from .llm_integration import LlamaIntegration
from .prompts import EMOTION_PROMPTS, GREETING_KEYWORDS, FAREWELL_KEYWORDS, IDENTITY_PATTERNS

class Chatbot:
    def __init__(self):
        self.chat_history: List[str] = []
        self.emotion_classifier = EmotionClassifier()
        try:
            self.llm = LlamaIntegration()
        except Exception as e:
            print(f"Warning: LLM initialization failed - {str(e)}")
            self.llm = None
    
    def detect_category(self, text: str) -> str:
        text_lower = text.lower().strip()
        text_lower = re.sub(r"[^\w\s]", "", text_lower)
        
        if any(re.search(pattern, text_lower) for pattern in IDENTITY_PATTERNS):
            return "identity"
        if any(re.search(rf"\b{re.escape(greet)}\b", text_lower) for greet in GREETING_KEYWORDS):
            return "greeting"
        if any(re.search(rf"\b{re.escape(fare)}\b", text_lower) for fare in FAREWELL_KEYWORDS):
            return "farewell"
        return None

    def get_direct_response(self, category: str) -> str:
        responses = {
            "greeting": [
                "Hello! 😊 How are you feeling today?",
                "Hey there! I'm Memory Lane Assistant. How's your day going?",
                "Hi! 👋 What's on your mind today?",
                "Hey! I'm here for you. How can I help you?",
                "Good to see you! How are you feeling?"
            ],
            "farewell": [
                "Goodbye! 😊 Take care and reach out anytime you need me.",
                "See you soon! I'm always here when you need me. 💙",
                "Bye for now! Stay safe and take care. 🌸",
                "Farewell! Hope to chat with you again soon. 😊",
                "Take care! Remember, I'm always here for you. 💙"
            ],
            "identity": (
                "🌟 Hi! I'm Memory Lane Assistant. 🌟\n"
                "I'm here to help you with your Alzheimer's care journey. "
                "You can ask me about your schedule, medications, or just chat!"
            )
        }
        return random.choice(responses.get(category, ["I'm here to help. What would you like to know?"]))
    
    def classify_emotion(self, text: str, topk: int = 1) -> List[Dict[str, str]]:
        return self.emotion_classifier.classify(text, topk)
    
    def generate_response(self, user_input: str) -> str:
        # Check for direct responses first
        category = self.detect_category(user_input)
        if category:
            return self.get_direct_response(category)
        
        # If no direct response, use emotion classification and LLM
        emotions = self.classify_emotion(user_input, topk=3)
        dominant_emotion = emotions[0]["label"]
        
        # Update chat history
        self.chat_history.append(f"User ({dominant_emotion}): {user_input}")
        self.chat_history = self.chat_history[-10:]  # Keep last 10 messages
        
        # Get emotion-specific instruction
        emotion_instruction = EMOTION_PROMPTS.get(dominant_emotion, "Respond naturally.")
        
        # Create prompt for LLM
        prompt = (
            "You are an emotionally intelligent chatbot that provides warm and empathetic responses.\n"
            "Always acknowledge the user's feelings and offer thoughtful, caring advice.\n\n"
            f"Emotion-Specific Instruction: {emotion_instruction}\n\n"
            "Conversation History:\n" +
            "\n".join(self.chat_history) + "\n\n"
            "Chatbot:"
        )
        
        # Generate response
        try:
            if self.llm:
                chatbot_response = self.llm.generate_response(prompt)
            else:
                # Fallback simple responses if LLM is not available
                if "medication" in user_input.lower():
                    chatbot_response = "You can view and manage your medications in the Schedule tab."
                elif "appointment" in user_input.lower():
                    chatbot_response = "Your upcoming appointments are listed in the Schedule section."
                elif "game" in user_input.lower():
                    chatbot_response = "Playing memory games can help with cognitive health. Try our games in the Games tab!"
                elif "alzheimer" in user_input.lower():
                    chatbot_response = "I'm here to support you through your Alzheimer's journey. Let me know how I can help."
                else:
                    chatbot_response = "I'm here to help with your Alzheimer's care. You can ask me about your schedule, medications, or games."
            
            # Update chat history with bot response
            self.chat_history.append(f"Chatbot: {chatbot_response}")
            self.chat_history = self.chat_history[-10:]
            
            return chatbot_response
        except Exception as e:
            print(f"Error generating response: {str(e)}")
            return "I'm having trouble connecting, but I'm still here for you."

# Singleton instance
chatbot_instance = Chatbot()