from transformers import AutoModelForSequenceClassification, AutoTokenizer
import torch

device = "cuda" if torch.cuda.is_available() else "cpu"

class EmotionClassifier:
    def __init__(self, model_name="Yuki-Chen/fine_tuned_BERT_goemotions_1"):
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModelForSequenceClassification.from_pretrained(model_name).to(device)
    
    def classify(self, text, topk=1):
        try:
            inputs = self.tokenizer(text, return_tensors="pt", truncation=True, max_length=512).to(device)
            with torch.no_grad():
                outputs = self.model(**inputs)
            probabilities = torch.nn.functional.softmax(outputs.logits, dim=1)
            top_probs, top_labels = torch.topk(probabilities, topk)
            
            return [{
                "label": self.model.config.id2label[label.item()],
                "score": prob.item()
            } for prob, label in zip(top_probs[0], top_labels[0])]
        except Exception:
            return [{"label": "neutral", "score": 1.0}]