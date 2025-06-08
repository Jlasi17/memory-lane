EMOTION_PROMPTS = {
     "admiration": "The user is expressing admiration. Respond with enthusiasm and engage positively.",
    "amusement": "The user is amused. Keep the conversation light and playful.",
    "anger": "The user is angry. Validate their feelings and help them process their emotions calmly.",
    "annoyance": "The user is annoyed. Acknowledge their frustration and provide helpful suggestions.",
    "approval": "The user is approving of something. Engage and continue the positive discussion.",
    "caring": "The user is expressing care. Respond with warmth and kindness.",
    "confusion": "The user is confused. Provide clear, step-by-step guidance to help them understand.",
    "curiosity": "The user is curious. Encourage their exploration and provide insightful answers.",
    "desire": "The user is expressing desire. Respond supportively and engage in discussion.",
    "disappointment": "The user is disappointed. Show empathy and offer encouragement.",
    "disapproval": "The user disapproves of something. Respect their viewpoint and discuss constructively.",
    "disgust": "The user is disgusted. Understand their perspective and respond appropriately.",
    "embarrassment": "The user is embarrassed. Reassure them and make them feel at ease.",
    "excitement": "The user is excited. Engage with enthusiasm and encourage their energy.",
    "fear": "The user is afraid. Offer reassurance and support.",
    "gratitude": "The user is expressing gratitude. Acknowledge their appreciation and respond warmly.",
    "grief": "The user is grieving. Offer support, sympathy, and patience.",
    "joy": "The user is joyful. Celebrate their happiness and encourage positivity.",
    "love": "The user is expressing love. Respond warmly and supportively.",
    "nervousness": "The user is nervous. Help them feel reassured and offer calming advice.",
    "optimism": "The user is optimistic. Encourage their positivity and enthusiasm.",
    "pride": "The user is proud. Celebrate their achievements with them.",
    "realization": "The user has had a realization. Encourage their insights and discussion.",
    "relief": "The user feels relieved. Acknowledge their feelings and continue the conversation naturally.",
    "remorse": "The user feels remorse. Offer support and encourage self-forgiveness.",
    "sadness": "The user is sad. Respond with empathy and emotional support.",
    "surprise": "The user is surprised. Engage with curiosity and discuss the surprise.",
    "neutral": "The user is neutral. Respond naturally based on the conversation flow."
}

GREETING_KEYWORDS = {"hello", "hi", "hey", "good morning", "good afternoon", "good evening",
                     "what's up", "howdy", "hiya", "yo", "greetings", "sup", "morning",
                     "evening", "good day", "how do you do", "how are you", "how are you doing",
                     "how's everything", "how's it going", "how have you been", "what's new"}

FAREWELL_KEYWORDS = {"bye", "goodbye", "see you", "take care", "later", "farewell",
                     "see you soon", "talk to you later", "peace", "so long"}

IDENTITY_PATTERNS = [r"\bwho are you\b", r"\what is your name\b", 
                     r"\bwho is Suhrt\b", r"\bwhat is Suhrt\b", 
                     r"\btell me about Suhrt\b"]