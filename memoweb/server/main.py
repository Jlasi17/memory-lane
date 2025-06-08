from fastapi import FastAPI, HTTPException, Depends, Request, status, UploadFile, File, Form, BackgroundTasks,APIRouter
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger
from pathlib import Path
import torch
from pydantic import BaseModel
from torchvision import transforms
from torchvision.models import resnet18, ResNet18_Weights
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from bson.errors import InvalidId
from dotenv import load_dotenv
import os
import bcrypt
from datetime import datetime, timedelta
import jwt
from typing import Optional, List,Dict
from pydantic import BaseModel, Field, EmailStr, field_validator
import re
import io
import random
import string
import uuid
from datetime import datetime, timedelta
import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from PIL import Image
import cloudinary
import cloudinary.uploader
import cloudinary.api
from bot.bot_logic import chatbot_instance
from asyncio import TimeoutError
import asyncio
from groq import Groq
from random import choice


# Load environment variables
load_dotenv()

# Email configuration (add to your .env file)
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
EMAIL_ADDRESS = os.getenv("EMAIL_ADDRESS")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")

# Initialize FastAPI
app = FastAPI()
router = APIRouter()
scheduler = AsyncIOScheduler()



cloudinary.config(
  cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME"),
  api_key = os.getenv("CLOUDINARY_API_KEY"),
  api_secret = os.getenv("CLOUDINARY_API_SECRET"),
  secure=True
)


# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MongoDB Configuration
client = AsyncIOMotorClient(
    os.getenv("MONGODB_URL"),
    tls=True,
    tlsAllowInvalidCertificates=True  # Only for development!
)
db = client.memorylane
scores_collection = db.scores

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

# Security Configuration
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

stage_names = ['MildDemented', 'ModerateDemented', 'NonDemented', 'VeryMildDemented']

# Preprocessing transform
transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
])

# Load model
def load_model(model_path="../models/resnet18_alzheimer_model.pth"):
    weights = ResNet18_Weights.DEFAULT
    model = resnet18(weights=weights)
    num_ftrs = model.fc.in_features
    model.fc = torch.nn.Linear(num_ftrs, len(stage_names))
    model.load_state_dict(torch.load(model_path, map_location="cpu"))
    model.eval()
    return model

model = load_model()

def convert_mongo_doc(doc):
    """Recursively convert MongoDB documents to JSON-serializable format"""
    if doc is None:
        return None
    if isinstance(doc, (str, int, float, bool)):
        return doc
    if isinstance(doc, ObjectId):
        return str(doc)
    if isinstance(doc, datetime):
        return doc.isoformat()
    if isinstance(doc, list):
        return [convert_mongo_doc(item) for item in doc]
    if isinstance(doc, dict):
        return {k: convert_mongo_doc(v) for k, v in doc.items()}
    # Handle other cases (like custom objects with __dict__)
    if hasattr(doc, '__dict__'):
        return convert_mongo_doc(doc.__dict__)
    return str(doc)  # Fallback for other types


# Pydantic Models
class User(BaseModel):
    username: str
    email: str
    role: str  # 'family', 'doctor', or 'patient'
    password: str

class Patient(BaseModel):
    name: str = Field(..., min_length=2, max_length=50, example="John Doe")
    age: int = Field(..., gt=0, lt=120, example=65)
    gender: str = Field(..., pattern="^(male|female|other)$", example="male")
    medical_history: Optional[str] = Field(None, max_length=1000, example="Hypertension, Diabetes")
    email: EmailStr = Field(..., example="patient@example.com")
    phone: str = Field(..., min_length=10, max_length=15, example="8801177005")
    user_id: Optional[str] = None
    patient_id: Optional[str] = None  # New 6-digit patient ID
    passcode: Optional[str] = None
    caretakers: List[str] = []
    stage: Optional[str] = Field(None, pattern="^(non_demented|mild|moderate|severe|unknown)$")
    appointments: List[str] = Field(default_factory=list)  # Added for appointments
    medications: List[str] = Field(default_factory=list)   # Added for medications

    @field_validator('phone')
    @classmethod
    def validate_phone(cls, v):
        if not re.match(r'^[0-9]{10,15}$', v):
            raise ValueError('Phone must be 10-15 digits')
        return v

class LoginForm(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None

class Notification(BaseModel):
    user_id: str
    message: str
    read: bool = False
    created_at: datetime = datetime.utcnow()

class UserResponse(BaseModel):
    username: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    is_active: Optional[bool] = True

class ImageResponse(BaseModel):
    id: str
    patient_id: str
    description: str
    upload_date: datetime
    content_type: str
    image_url: Optional[str] = None
    type: str  # "situation" or "person"
    person_name: Optional[str] = None
    relation_to_patient: Optional[str] = None

class MRIScanBase(BaseModel):
    patient_id: str
    scan_date: datetime
    file_path: str
    original_filename: str
    file_size: int
    notes: Optional[str] = None
    uploaded_by: str
    uploaded_at: datetime

class MRIScanCreate(MRIScanBase):
    pass

class MRIScanInDB(MRIScanBase):
    id: str

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }

# Appointments Models
class AppointmentCreate(BaseModel):
    patient_id: str
    date: str  # YYYY-MM-DD
    time: str  # HH:MM
    description: str = None

class AppointmentResponse(BaseModel):
    id: str
    patient_id: str
    patient_name: str
    doctor_id: str
    date: str
    time: str
    description: str
    created_at: datetime
    completed: bool = False

    class Config:
        validate_by_name = True


# Medications Models
class MedicationCreate(BaseModel):
    patient_id: str
    name: str
    time: List[str]
    duration: int
    notes: str = None


class MedicationResponse(BaseModel):
    id: str
    patient_id: str
    patient_name: str
    doctor_id: str
    name: str
    time: List[str]
    duration: Optional[int] = None
    notes: str
    created_at: datetime
    expires_at: Optional[datetime] = None
    taken_times: List[dict] = Field(default_factory=list)

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat(),
            ObjectId: lambda v: str(v)
        }

class AppointmentStatusUpdate(BaseModel):
    completed: bool

class MedicationStatusUpdate(BaseModel):
    taken: bool
    time: str

class ScoreData(BaseModel):
    player_name: str
    score: int
    rounds_completed: int


# Helper Functions
def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        return await db.users.find_one({"username": username})
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.PyJWTError:
        raise credentials_exception

def generate_patient_id():
    return ''.join(random.choices(string.digits, k=6))

def generate_passcode():
    return ''.join(random.choices(string.digits, k=8))

async def predict_alzheimer(image_bytes: bytes):
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image_tensor = transform(image).unsqueeze(0)
        
        with torch.no_grad():
            outputs = model(image_tensor)
            probabilities = torch.nn.functional.softmax(outputs, dim=1)
            _, predicted = torch.max(outputs, 1)
            prediction = stage_names[predicted.item()]
            confidence = probabilities[0][predicted.item()].item()
            
        return {
            "prediction": prediction,
            "confidence": confidence,
            "status": "completed"
        }
    except Exception as e:
        logging.error(f"Prediction failed: {str(e)}")
        return {"status": "failed", "error": str(e)}
    
async def send_email_notification(email: str, subject: str, message: str):
    try:
        print(f"[{datetime.now().isoformat()}] Attempting to send email to: {email}")
        msg = MIMEMultipart()
        msg['From'] = EMAIL_ADDRESS
        msg['To'] = email
        msg['Subject'] = subject
        
        msg.attach(MIMEText(message, 'html'))
        
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(EMAIL_ADDRESS, EMAIL_PASSWORD)
            server.sendmail(EMAIL_ADDRESS, email, msg.as_string())
            
        print(f"[{datetime.now().isoformat()}] Email successfully sent to {email}")
        return True
    except Exception as e:
        print(f"[{datetime.now().isoformat()}] Failed to send email: {str(e)}")
        return False

async def create_notification(user_id: str, message: str, notification_type: str, 
                             related_id: str = None, remind_later: bool = False):
    notification = {
        "user_id": user_id,
        "message": message,
        "type": notification_type,
        "related_id": related_id,
        "read": False,
        "remind_later": remind_later,
        "created_at": datetime.utcnow()
    }
    await db.notifications.insert_one(notification)
    return notification

async def check_appointment_reminders():
    try:
        now = datetime.utcnow()
        # Only look for appointments in the next 15 minutes (since this runs every 15 minutes)
        upcoming_window = now + timedelta(minutes=15)
        
        # Find appointments happening in the next 15 minutes
        appointments = await db.appointments.find({
            "date": {"$gte": now.strftime("%Y-%m-%d"), "$lte": upcoming_window.strftime("%Y-%m-%d")},
            "time": {
                "$gte": now.strftime("%H:%M"),
                "$lte": upcoming_window.strftime("%H:%M")
            },
            "completed": False,
            "reminder_sent": {"$ne": True}  # Only if reminder hasn't been sent
        }).to_list(None)
        
        for appt in appointments:
            # Get patient details
            patient = await db.patients.find_one({"patient_id": appt["patient_id"]})
            if not patient:
                continue
                
            # Parse appointment time
            appt_time = datetime.strptime(f"{appt['date']} {appt['time']}", "%Y-%m-%d %H:%M")
            time_until = appt_time - now
            minutes_until = int(time_until.total_seconds() / 60)
            
            # Only send notification if it's about 10 minutes before the appointment
            if 5 <= minutes_until <= 15:  # Small buffer to account for timing
                # Create in-app notification with "Remind me later" option
                message = f"Your appointment is in about 10 minutes: {appt.get('description', 'No description')}"
                
                await create_notification(
                    user_id=appt["patient_id"],
                    message=message,
                    notification_type="appointment",
                    related_id=str(appt["_id"]),
                    remind_later=True
                )
                
                # Also send an email notification
                email_subject = f"Appointment Reminder - Starting in 10 minutes"
                email_body = f"""
                <h2>Appointment Starting Soon</h2>
                <p>Your appointment is scheduled to start in about 10 minutes at {appt_time.strftime('%I:%M %p')}.</p>
                <p><strong>Details:</strong> {appt.get('description', 'No additional details')}</p>
                """
                await send_email_notification(patient["email"], email_subject, email_body)
                
                # Mark reminder as sent
                await db.appointments.update_one(
                    {"_id": appt["_id"]},
                    {"$set": {"reminder_sent": True}}
                )
            
    except Exception as e:
        print(f"Error in appointment reminders: {str(e)}")

async def check_medication_reminders():
    try:
        now = datetime.utcnow()
        upcoming_window = now + timedelta(minutes=10)
        current_time_str = now.strftime("%H:%M")
        
        # Find all active medications
        medications = await db.medications.find({
            "expires_at": {"$gt": now},
            "time": {"$exists": True, "$ne": []}
        }).to_list(None)
        
        for med in medications:
            # Check if any of the medication times are within the next 10 minutes
            for time_slot in med["time"]:
                # Convert time slot to datetime for comparison
                try:
                    med_time = datetime.strptime(time_slot, "%H:%M").time()
                    current_time = now.time()
                    
                    # Check if this time slot is within the next 10 minutes
                    if (datetime.combine(now.date(), med_time) - now).total_seconds() <= 600:
                        # Check if already taken today
                        taken_today = any(
                            t.get("date") == now.strftime("%Y-%m-%d") and t.get("time") == time_slot
                            for t in med.get("taken_times", [])
                        )
                        
                        if not taken_today:
                            # Get patient details
                            patient = await db.patients.find_one({"patient_id": med["patient_id"]})
                            if not patient:
                                continue
                                
                            # Create notification
                            message = f"Time to take your medication: {med['name']} ({time_slot})"
                            
                            await create_notification(
                                user_id=med["patient_id"],
                                message=message,
                                notification_type="medication",
                                related_id=str(med["_id"])
                            )
                            
                except ValueError:
                    continue
                    
    except Exception as e:
        print(f"Error in medication reminders: {str(e)}")



# Routes
@app.get("/")
async def root():
    return {
        "message": "Memory Lane API", 
        "status": "running",
        "docs": "http://127.0.0.1:8000/docs"
    }

@app.exception_handler(404)
async def not_found(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=404,
        content={
            "message": "Endpoint not found",
            "available_endpoints": [
                "/register",
                "/login",
                "/patients",
                "/api/register_patient",
                "/api/patient_stats"
            ]
        }
    )

@app.post("/register")
async def register(user: User):
    if await db.users.find_one({"username": user.username}):
        raise HTTPException(status_code=400, detail="Username already exists")
    
    hashed = bcrypt.hashpw(user.password.encode(), bcrypt.gensalt())
    
    result = await db.users.insert_one({
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "hashed_password": hashed.decode()
    })
    
    return {"id": str(result.inserted_id)}

@app.post("/login")
async def login(form: LoginForm):
    try:
        print(f"Login attempt for username: {form.username}")
        
        # Find the user
        user = await db.users.find_one({"username": form.username})
        print(f"Found user: {user is not None}")
        
        if not user:
            print("User not found")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password"
            )
            
        # Convert ObjectId to string for JSON serialization
        user['_id'] = str(user['_id'])
        print(f"User document: {user}")
        
        # Verify password
        try:
            password_valid = bcrypt.checkpw(
                form.password.encode(), 
                user["hashed_password"].encode()
            )
            print(f"Password validation result: {password_valid}")
        except Exception as e:
            print(f"Password validation error: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error validating credentials"
            )
            
        if not password_valid:
            print("Invalid password")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password"
            )
        
        # Generate access token
        try:
            access_token = create_access_token(
                data={"sub": user["username"]},
                expires_delta=timedelta(days=7)
            )
            print("Access token generated successfully")
        except Exception as e:
            print(f"Token generation error: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error generating access token"
            )
        
        # Prepare response
        response_data = {
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "username": user["username"],
                "role": user.get("role", "patient"),
                "email": user.get("email")
            }
        }
        print(f"Preparing response: {response_data}")
        
        # Update user's tokens list
        try:
            await db.users.update_one(
                {"_id": ObjectId(user["_id"])},
                {"$push": {"tokens": access_token}}
            )
            print("Token stored in database")
        except Exception as e:
            print(f"Error storing token: {str(e)}")
            # Continue even if token storage fails
            
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content=response_data
        )
        
    except HTTPException as he:
        print(f"HTTP Exception in login: {he.detail}")
        raise he
    except Exception as e:
        print(f"Unexpected error in login: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An unexpected error occurred: {str(e)}"
        )

@app.post("/token", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    user = await db.users.find_one({"username": form_data.username})
    if not user or not bcrypt.checkpw(form_data.password.encode(), user["hashed_password"].encode()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user["username"]}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

async def send_patient_credentials(email: str, patient_id: str, passcode: str):
    try:
        print(f"Attempting to send email to: {email}")
        
        msg = MIMEMultipart()
        msg['From'] = EMAIL_ADDRESS
        msg['To'] = email
        msg['Subject'] = "Memory Lane - Your Patient Credentials"
        
        body = f"""
        <h2>Welcome to Memory Lane</h2>
        <p><strong>Patient ID:</strong> {patient_id}</p>
        <p><strong>Temporary Passcode:</strong> {passcode}</p>
        <p>Please login at: https://jlasi17.github.io/memolane/#/</p>
        """
        
        msg.attach(MIMEText(body, 'html'))
        
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(EMAIL_ADDRESS, EMAIL_PASSWORD)
            server.sendmail(EMAIL_ADDRESS, email, msg.as_string())
            print("Email successfully sent!")
            
        return True
    except Exception as e:
        print(f"SMTP Error Details: {str(e)}")
        if hasattr(e, 'smtp_error'):
            print(f"SMTP Server Error: {e.smtp_error.decode()}")
        return False
                   
@app.post("/api/register_patient")
async def register_patient(patient: Patient, current_user: dict = Depends(get_current_user)):
    try:
        if patient.patient_id:
            existing_patient = await db.patients.find_one({"patient_id": patient.patient_id})
            if not existing_patient:
                raise HTTPException(status_code=404, detail="Patient ID not found")
            
            await db.patients.update_one(
                {"patient_id": patient.patient_id},
                {"$addToSet": {"caretakers": current_user["username"]}}
            )
            
            return {"success": True, "message": "Patient linked successfully"}
        if await db.users.find_one({"email": patient.email}):
            raise HTTPException(
                status_code=400,
                detail="Email already registered"
            )
        
        patient_id = generate_patient_id()
        passcode = generate_passcode()
        hashed_passcode = bcrypt.hashpw(passcode.encode(), bcrypt.gensalt()).decode()
        
        patient_user = {
            "username": patient_id,
            "email": patient.email,
            "role": "patient",
            "hashed_password": hashed_passcode,
            "created_at": datetime.utcnow()
        }
        
        patient_data = patient.model_dump()
        patient_data.update({
            "patient_id": patient_id,
            "passcode": passcode,
            "caretakers": [current_user["username"]],
            "created_at": datetime.utcnow(),
            "appointments": [],
            "medications": []
        })
        del patient_data["user_id"]

        async with await client.start_session() as session:
            async with session.start_transaction():
                await db.users.insert_one(patient_user, session=session)
                await db.patients.insert_one(patient_data, session=session)
        
        email_sent = await send_patient_credentials(
            patient.email,
            patient_id,
            passcode
        )
        
        if not email_sent:
            print(f"Failed to send email to {patient.email}")
        
        return {
            "success": True,
            "patient_id": patient_id,
            "passcode": passcode,
            "message": "Patient registered successfully. Credentials sent to email."
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
        
@app.get("/api/patient_stats")
async def get_patient_stats(current_user: dict = Depends(get_current_user)):
    patient = await db.patients.find_one({
        "$or": [
            {"user_id": current_user["username"]},
            {"caretakers": current_user["username"]},
            {"patient_id": current_user["username"]}
        ]
    })
    
    if not patient:
        raise HTTPException(
            status_code=404,
            detail="No patient found for this user"
        )
    
    return {
        "patient": convert_mongo_doc({
            "name": patient["name"],
            "age": patient["age"],
            "gender": patient["gender"],
            "patient_id": patient["patient_id"],
            "alzheimer_stage": patient.get("alzheimer_stage", "unknown"),
            "appointments": patient.get("appointments", []),
            "medications": patient.get("medications", [])
        }),
        "stats": {
            "last_updated": datetime.utcnow(),
            "medication_adherence": patient.get("adherence", 0)
        }
    }


@app.get("/patients", response_model=List[Patient])
async def get_patients(current_user: dict = Depends(get_current_user)):
    if current_user["role"] == "doctor":
        patients = await db.patients.find().to_list(100)
    else:
        patients = await db.patients.find({
            "$or": [
                {"user_id": current_user["username"]},
                {"caretakers": current_user["username"]}
            ]
        }).to_list(100)
    
    return patients

# Startup Event
@app.on_event("startup")
async def startup_db_client():
    await db.command("ping")
    print("Successfully connected to MongoDB!")

    collections = await db.list_collection_names()
    print("Existing collections:", collections)
    
    if "scores" not in collections:
        await db.create_collection("scores")
        print("Created scores collection")
    
    if "game_users" not in collections:
        await db.create_collection("game_users")
        print("Created game_users collection")
    
    # Initialize scheduler
    scheduler = AsyncIOScheduler()
    scheduler.start()
    app.state.scheduler = scheduler
    print("Scheduler started")
    
    # Schedule periodic tasks
    scheduler.add_job(
        check_appointment_reminders,
        'interval',
        minutes=15,
        next_run_time=datetime.now() + timedelta(seconds=10)
    )
    scheduler.add_job(
        check_medication_reminders,
        'interval',
        minutes=5,
        next_run_time=datetime.now() + timedelta(seconds=10)
    )

@app.on_event("startup")
async def create_indexes():
    await db.patients.create_index([("patient_id", 1)])
    await db.patients.create_index([("alzheimer_stage", 1)])
    await db.patients.create_index([("last_scan_date", -1)])
    await db.appointments.create_index([("doctor_id", 1)])
    await db.appointments.create_index([("date", 1), ("time", 1)])
    await db.medications.create_index([("expires_at", 1)])
    await db.scores.create_index([("game_name", 1)])
    await db.scores.create_index([("score", -1)])
    await db.scores.create_index([("date", -1)])
    scheduler.add_job(
        generate_weekly_reports,
        'cron',
        day_of_week='sun',
        hour=3,
        minute=0,
        next_run_time=datetime.now() + timedelta(seconds=10)
    )


@app.get("/api/notifications")
async def get_notifications(current_user: dict = Depends(get_current_user)):
    try:
        notifications = []
        async for notification in db.notifications.find(
            {"user_id": current_user["username"]}
        ).sort("created_at", -1).limit(100):
            notifications.append(convert_mongo_doc(notification))
        
        return notifications
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@app.post("/api/notifications")
async def update_notifications(
    data: dict,
    current_user: dict = Depends(get_current_user)
):
    try:
        if data.get("type") == "mark_read":
            notifications = data.get("notifications", [])
            for notif in notifications:
                notif_id = notif.get("id")
                if notif_id:
                    await db.notifications.update_one(
                        {"_id": ObjectId(notif_id)},
                        {"$set": {"read": True}}
                    )
            return {"message": "Notifications marked as read"}
        else:
            # Handle creating new notification
            notification = {
                "user_id": current_user["username"],
                "message": data.get("message"),
                "type": data.get("type", "general"),
                "read": False,
                "created_at": datetime.utcnow()
            }
            result = await db.notifications.insert_one(notification)
            return {"id": str(result.inserted_id)}
            
    except Exception as e:
        print(f"Error updating notifications: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to update notifications"
        )

@app.get("/api/user_patients")
async def get_user_patients(current_user: dict = Depends(get_current_user)):
    try:
        patients = []
        async for patient in db.patients.find({"caretakers": current_user["username"]}):
            patients.append(convert_mongo_doc(patient))
        
        return {"patients": patients}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/user")
async def get_user(current_user: dict = Depends(get_current_user)):
    return {"username": current_user["username"]}
    

# Update your upload endpoint
@app.post("/api/upload_image")
async def upload_image(
    image: UploadFile = File(...),
    description: str = Form(...),
    patient_id: str = Form(...),
    type: str = Form(...),  # New field
    person_name: Optional[str] = Form(None),  # New field
    relation_to_patient: Optional[str] = Form(None),  # New field
    current_user: dict = Depends(get_current_user)
):
    try:
        # Validate type
        if type not in ["situation", "person"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid image type. Must be 'situation' or 'person'"
            )
            
        # Validate person fields if type is 'person'
        if type == "person":
            if not person_name:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Person name is required for 'person' type"
                )
            if not relation_to_patient:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Relation to patient is required for 'person' type"
                )

        # Rest of your existing validation
        if not image or image.filename == '':
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No image file selected"
            )

        if not image.content_type or not image.content_type.startswith('image/'):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only image files are allowed"
            )

        contents = await image.read()
        
        # Upload to Cloudinary
        upload_result = cloudinary.uploader.upload(
            contents,
            folder=f"memorylane/{patient_id}",
            public_id=f"img_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        )
        
        # Update image document with new fields
        image_doc = {
            "patient_id": patient_id,
            "description": description,
            "original_filename": image.filename,
            "content_type": image.content_type,
            "file_size": len(contents),
            "uploaded_by": current_user["username"],
            "uploaded_at": datetime.utcnow(),
            "cloudinary_url": upload_result["secure_url"],
            "cloudinary_public_id": upload_result["public_id"],
            "type": type,
            "person_name": person_name if type == "person" else None,
            "relation_to_patient": relation_to_patient if type == "person" else None
        }

        result = await db.images.insert_one(image_doc)

        return {
            "success": True,
            "message": "Image uploaded successfully",
            "image_id": str(result.inserted_id),
            "patient_id": patient_id,
            "filename": image.filename,
            "url": upload_result["secure_url"],
            "file_size": len(contents),
            "uploaded_at": datetime.utcnow().isoformat(),
            "type": type,
            "person_name": person_name,
            "relation_to_patient": relation_to_patient
        }

    except HTTPException as he:
        return {
            "success": False,
            "message": he.detail,
            "status_code": he.status_code
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Upload failed: {str(e)}",
            "status_code": 500
        }


@app.get("/api/images/{patient_id}")
async def get_patient_images(
    patient_id: str,
    current_user: dict = Depends(get_current_user)
):
    patient = await db.patients.find_one({
        "patient_id": patient_id,
        "$or": [
            {"user_id": current_user["username"]},
            {"caretakers": current_user["username"]}
        ]
    })
    
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient not found or access denied"
        )

    images = []
    async for img in db.images.find({"patient_id": patient_id}).sort("uploaded_at", -1):
        images.append({
            "id": str(img["_id"]),
            "patient_id": img["patient_id"],
            "description": img["description"],
            "url": img["cloudinary_url"],
            "original_filename": img["original_filename"],
            "uploaded_at": img["uploaded_at"],
            "file_size": img["file_size"]
        })
    
    return {"images": images}



@app.delete("/api/images/{image_id}")
async def delete_image(
    image_id: str,
    current_user: dict = Depends(get_current_user)
):
    try:
        img = await db.images.find_one({"_id": ObjectId(image_id)})
        
        if not img:
            raise HTTPException(status_code=404, detail="Image not found")

        patient = await db.patients.find_one({
            "patient_id": img["patient_id"],
            "$or": [
                {"user_id": current_user["username"]},
                {"caretakers": current_user["username"]}
            ]
        })
        
        if not patient:
            raise HTTPException(status_code=403, detail="Access denied")

        # Delete from Cloudinary
        if "cloudinary_public_id" in img:
            cloudinary.uploader.destroy(img["cloudinary_public_id"])

        await db.images.delete_one({"_id": ObjectId(image_id)})

        return {"success": True, "message": "Image deleted successfully"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/upload_mri_scan")
async def upload_mri_scan(
    background_tasks: BackgroundTasks,
    scan_file: UploadFile = File(...),
    patient_id: str = Form(...),
    scan_date: str = Form(...),
    notes: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user)
):
    try:
        patient = await db.patients.find_one({
            "patient_id": patient_id,
            "$or": [
                {"user_id": current_user["username"]},
                {"caretakers": current_user["username"]}
            ]
        })
        
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found or access denied")

        valid_extensions = ('.jpg', '.jpeg', '.png', '.dicom', '.nii', '.nii.gz')
        if not scan_file.filename.lower().endswith(valid_extensions):
            raise HTTPException(status_code=400, 
                              detail=f"Only {', '.join(valid_extensions)} files allowed")

        contents = await scan_file.read()
        
        # Upload to Cloudinary
        upload_result = cloudinary.uploader.upload(
            contents,
            folder=f"memorylane/mri_scans/{patient_id}",
            public_id=f"mri_{datetime.now().strftime('%Y%m%d%H%M%S')}",
            resource_type="raw"  # Important for non-image files
        )

        scan_doc = {
            "patient_id": patient_id,
            "scan_date": datetime.strptime(scan_date, "%Y-%m-%d"),
            "original_filename": scan_file.filename,
            "file_size": len(contents),
            "notes": notes,
            "uploaded_by": current_user["username"],
            "uploaded_at": datetime.utcnow(),
            "processing_status": "pending",
            "cloudinary_url": upload_result["secure_url"],
            "cloudinary_public_id": upload_result["public_id"],
            "alzheimer_prediction": {
                "status": "pending"
            }
        }

        result = await db.mri_scans.insert_one(scan_doc)
        scan_id = str(result.inserted_id)
        
        background_tasks.add_task(
            process_mri_prediction,
            contents,
            scan_id,
            patient_id,
            current_user["username"]
        )
        
        return {
            "success": True,
            "message": "MRI scan uploaded. Processing started.",
            "scan_id": scan_id
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

async def process_mri_prediction(image_bytes: bytes, scan_id: str, patient_id: str, username: str):
    try:
        await db.mri_scans.update_one(
            {"_id": ObjectId(scan_id)},
            {"$set": {
                "processing_status": "processing",
                "alzheimer_prediction.status": "processing"
            }}
        )
        
        prediction_result = await predict_alzheimer(image_bytes)
        
        stage = None
        if prediction_result["prediction"] == "NonDemented":
            stage = "0"
        elif prediction_result["prediction"] == "VeryMildDemented":
            stage = "1"
        elif prediction_result["prediction"] == "MildDemented":
            stage = "2"
        elif prediction_result["prediction"] == "ModerateDemented":
            stage = "3"
        
        update_data = {
            "processing_status": "completed",
            "alzheimer_prediction": {
                "status": "completed",
                "prediction": prediction_result["prediction"],
                "confidence": prediction_result["confidence"],
                "stage": stage,
                "completed_at": datetime.utcnow()
            }
        }
        
        await db.mri_scans.update_one(
            {"_id": ObjectId(scan_id)},
            {"$set": update_data}
        )
        
        await db.patients.update_one(
            {"patient_id": patient_id},
            {
                "$set": {
                    "alzheimer_stage": stage,
                    "last_scan_date": datetime.utcnow(),
                    "last_scan_id": scan_id
                },
                "$push": {
                    "scan_history": {
                        "scan_id": scan_id,
                        "date": datetime.utcnow(),
                        "stage": stage,
                        "prediction": prediction_result["prediction"]
                    }
                }
            }
        )
        
    except Exception as e:
        await db.mri_scans.update_one(
            {"_id": ObjectId(scan_id)},
            {"$set": {
                "processing_status": f"failed: {str(e)}",
                "alzheimer_prediction.status": f"failed: {str(e)}"
            }}
        )
        raise

@app.get("/api/mri_scan/{scan_id}")
async def get_mri_scan(scan_id: str, current_user: dict = Depends(get_current_user)):
    try:
        scan = await db.mri_scans.find_one(
            {"_id": ObjectId(scan_id)},
            projection={
                "patient_id": 1,
                "scan_date": 1,
                "file_path": 1,
                "processing_status": 1,
                "alzheimer_prediction": 1,
                "uploaded_at": 1
            }
        )
        
        if not scan:
            raise HTTPException(status_code=404, detail="Scan not found")
            
        patient = await db.patients.find_one({
            "patient_id": scan["patient_id"],
            "$or": [
                {"user_id": current_user["username"]},
                {"caretakers": current_user["username"]}
            ]
        })
        
        if not patient:
            raise HTTPException(status_code=403, detail="Access denied")
        
        return convert_mongo_doc(scan)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@app.get("/api/patients/{patient_id}")
async def get_patient(
    patient_id: str,
    current_user: dict = Depends(get_current_user)
):
    try:
        patient = await db.patients.find_one({
            "patient_id": patient_id,
            "$or": [
                {"user_id": current_user["username"]},
                {"caretakers": current_user["username"]}
            ]
        }, projection={
            "_id": 0,
            "patient_id": 1,
            "name": 1,
            "alzheimer_stage": 1,
            "last_scan_date": 1,
            "scan_history": 1
        })
        
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found or access denied")
            
        return convert_mongo_doc(patient)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Appointments Endpoints
@app.get("/api/appointments", response_model=List[AppointmentResponse])
async def get_appointments(
    patient_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all appointments for the current user"""
    try:
        # Build query based on user role
        query = {}
        
        if current_user["role"] == "doctor":
            query["doctor_id"] = current_user["username"]
            if patient_id:
                query["patient_id"] = patient_id
        else:
            # For patients/family, only show their own appointments
            patient = await db.patients.find_one({
                "$or": [
                    {"user_id": current_user["username"]},
                    {"caretakers": current_user["username"]},
                    {"patient_id": current_user["username"]}
                ]
            })
            
            if not patient:
                raise HTTPException(
                    status_code=404,
                    detail="Patient not found or access denied"
                )
            
            query["patient_id"] = patient["patient_id"]

        appointments = []
        async for appt in db.appointments.find(query).sort([("date", 1), ("time", 1)]):
            patient = await db.patients.find_one({"patient_id": appt["patient_id"]})
            doctor = await db.users.find_one({"username": appt["doctor_id"]})
            appt_date = appt["date"]
            if isinstance(appt_date, datetime):
                appt_date = appt_date.strftime("%Y-%m-%d")
            appointments.append({
                "id": str(appt["_id"]),
                "patient_id": appt["patient_id"],
                "patient_name": patient["name"] if patient else "Unknown",
                "doctor_id": appt["doctor_id"],
                "doctor_name": doctor.get("full_name", doctor["username"]) if doctor else "Unknown",
                "date": appt_date,
                "time": appt["time"],
                "description": appt.get("description", ""),
                "created_at": appt["created_at"],
                "completed": appt.get("completed", False)  # Include completed status
            })
        
        return appointments

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/appointments", response_model=AppointmentResponse)
async def create_appointment(
    appointment: AppointmentCreate,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """Create a new appointment"""
    try:
        # Validate date and time formats
        appointment_date = datetime.strptime(appointment.date, "%Y-%m-%d").date()
        datetime.strptime(appointment.time, "%H:%M")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date or time format")
    
    # Check if patient exists
    patient = await db.patients.find_one({"patient_id": appointment.patient_id})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    
    # Get patient name safely
    patient_name = patient.get("name", "Unknown Patient")
    
    # Check for time slot conflicts
    existing_appt = await db.appointments.find_one({
        "doctor_id": current_user["username"],
        "date": appointment.date,
        "time": appointment.time
    })
    
    if existing_appt:
        raise HTTPException(status_code=400, detail="Time slot already booked")
    
    # Create new appointment
    new_appt = {
        "patient_id": appointment.patient_id,
        "doctor_id": current_user["username"],
        "date": appointment.date,
        "time": appointment.time,
        "description": appointment.description,
        "created_at": datetime.utcnow(),
        "reminder_sent": False,
        "day_before_email_sent": False
    }
    
    result = await db.appointments.insert_one(new_appt)
    created_appt = await db.appointments.find_one({"_id": result.inserted_id})
    
    # Schedule day-before email
    appt_datetime = datetime.strptime(f"{appointment.date} {appointment.time}", "%Y-%m-%d %H:%M")
    day_before = appt_datetime - timedelta(days=1)
    
    if day_before > datetime.utcnow():
        background_tasks.add_task(
            send_day_before_appointment_email,
            patient["email"],
            patient_name,
            appointment.description,
            appt_datetime
        )
    
    return {
        "id": str(created_appt["_id"]),
        "patient_id": created_appt["patient_id"],
        "patient_name": patient_name,
        "doctor_id": created_appt["doctor_id"],
        "date": created_appt["date"],
        "time": created_appt["time"],
        "description": created_appt.get("description", ""),
        "created_at": created_appt["created_at"]
    }

async def send_day_before_appointment_email(email: str, patient_name: str, description: str, appt_datetime: datetime):
    try:
        # Wait until the day before the appointment
        print(f"[{datetime.now().isoformat()}] Scheduling day-before email for {email}")
        now = datetime.utcnow()
        send_time = appt_datetime - timedelta(days=1)
        
        if now < send_time:
            await asyncio.sleep((send_time - now).total_seconds())
        
        # Check if email already sent
        appointment = await db.appointments.find_one({
            "date": appt_datetime.strftime("%Y-%m-%d"),
            "time": appt_datetime.strftime("%H:%M"),
            "patient_id": email.split('@')[0]  # Assuming email is based on patient_id
        })
        
        if appointment and not appointment.get("day_before_email_sent", False):
            print(f"[{datetime.now().isoformat()}] Sending day-before appointment email to {email}")
            subject = f"Reminder: Appointment Tomorrow at {appt_datetime.strftime('%I:%M %p')}"
            body = f"""
            <h2>Appointment Reminder</h2>
            <p>Dear {patient_name},</p>
            <p>This is a reminder that you have an appointment tomorrow at {appt_datetime.strftime('%A, %B %d at %I:%M %p')}.</p>
            <p><strong>Details:</strong> {description or 'No additional details provided'}</p>
            <p>Please arrive 10 minutes early for your appointment.</p>
            """
            
            await send_email_notification(email, subject, body)
            print(f"[{datetime.now().isoformat()}] Day-before appointment email sent to {email}")
            # Mark email as sent
            await db.appointments.update_one(
                {"_id": appointment["_id"]},
                {"$set": {"day_before_email_sent": True}}
            )
            
    except Exception as e:
        print(f"Failed to send day-before email: {str(e)}")


@app.delete("/api/appointments/{appointment_id}")
async def delete_appointment(
    appointment_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Complete/delete an appointment"""
    try:
        # Validate the appointment_id
        obj_id = ObjectId(appointment_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Invalid appointment ID format")
    
    # Find and verify the appointment
    appointment = await db.appointments.find_one({
        "_id": obj_id,
        "doctor_id": current_user["username"]
    })
    
    if not appointment:
        raise HTTPException(status_code=404, detail="Appointment not found")
    
    try:
        # Remove from patient's appointments
        await db.patients.update_one(
            {"patient_id": appointment["patient_id"]},
            {"$pull": {"appointments": appointment_id}}
        )
        
        # Delete the appointment
        await db.appointments.delete_one({"_id": obj_id})
        
        return {"message": "Appointment completed/deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/appointments/{appointment_id}/status")
async def update_appointment_status(
    appointment_id: str,
    status: AppointmentStatusUpdate,
    current_user: dict = Depends(get_current_user)
):
    try:
        # Validate appointment_id
        try:
            appointment_oid = ObjectId(appointment_id)
        except:
            raise HTTPException(status_code=400, detail="Invalid appointment ID format")

        # Verify appointment exists and user has access
        appointment = await db.appointments.find_one({
            "_id": appointment_oid,
            "$or": [
                {"patient_id": current_user["username"]},  # Patient can mark their own appointments
                {"doctor_id": current_user["username"]}    # Doctor can mark their appointments
            ]
        })
        
        if not appointment:
            raise HTTPException(status_code=404, detail="Appointment not found or access denied")

        # Update status
        await db.appointments.update_one(
            {"_id": appointment_oid},
            {"$set": {"completed": status.completed}}
        )

        return {"success": True, "message": "Appointment status updated"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/medications/{medication_id}/status")
async def update_medication_status(
    medication_id: str,
    status: MedicationStatusUpdate,
    current_user: dict = Depends(get_current_user)
):
    try:
        # Validate medication_id
        try:
            medication_oid = ObjectId(medication_id)
        except:
            raise HTTPException(status_code=400, detail="Invalid medication ID format")

        # Verify medication exists and user has access
        medication = await db.medications.find_one({
            "_id": medication_oid,
            "patient_id": current_user["username"]  # Only patient can mark medications as taken
        })
        
        if not medication:
            raise HTTPException(status_code=404, detail="Medication not found or access denied")

        # Get the date (default to today if not provided)
        taken_date = status.date if hasattr(status, 'date') else datetime.utcnow().date().isoformat()

        # Update status - track each time it's taken with the date
        update_data = {
            "$push": {
                "taken_times": {
                    "time": status.time,
                    "date": taken_date,
                    "taken_at": datetime.utcnow()
                }
            }
        }

        await db.medications.update_one(
            {"_id": medication_oid},
            update_data
        )

        return {"success": True, "message": "Medication status updated"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
@app.get("/api/medications", response_model=List[MedicationResponse])
async def get_medications(
    patient_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    try:
        query = {}

        if current_user["role"] == "doctor":
            query["doctor_id"] = current_user["username"]
            if patient_id:
                query["patient_id"] = patient_id
        else:
            patient = await db.patients.find_one({
                "$or": [
                    {"user_id": current_user["username"]},
                    {"caretakers": current_user["username"]},
                    {"patient_id": current_user["username"]}
                ]
            })

            if not patient:
                raise HTTPException(
                    status_code=404,
                    detail="Patient not found or access denied"
                )

            query["patient_id"] = patient["patient_id"]

        medications = []

        async for med in db.medications.find(query).sort("created_at", -1):
            try:
                patient = await db.patients.find_one({"patient_id": med["patient_id"]})

                time_list = med.get("time", [])
                if isinstance(time_list, str):
                    time_list = [time_list]

                created_at = med.get("created_at")
                expires_at = med.get("expires_at")

                med_data = {
                    "id": str(med["_id"]),
                    "patient_id": med["patient_id"],
                    "patient_name": patient["name"] if patient else "Unknown",
                    "doctor_id": med["doctor_id"],
                    "name": med["name"],
                    "time": time_list,
                    "duration": med.get("duration", 0),
                    "notes": med.get("notes", ""),
                    "created_at": created_at.isoformat() if isinstance(created_at, datetime) else str(created_at) if created_at else None,
                    "expires_at": expires_at.isoformat() if isinstance(expires_at, datetime) else str(expires_at) if expires_at else None,
                    "taken_times": med.get("taken_times", [])
                }

                medications.append(MedicationResponse(**med_data))

            except Exception as inner_e:
                print("Error processing medication:", med)
                print("Exception:", inner_e)
                continue

        return medications

    except HTTPException:
        raise
    except Exception as e:
        print("Unhandled error in /api/medications:", e)
        raise HTTPException(status_code=500, detail=str(e))
    

@app.post("/api/medications", response_model=MedicationResponse)
async def create_medication(
    medication: MedicationCreate,
    current_user: dict = Depends(get_current_user)
):
    try:
        valid_times = {"Morning", "Afternoon", "Evening"}
        if not medication.time or any(t not in valid_times for t in medication.time):
            raise HTTPException(
                status_code=400,
                detail=f"Time must be any of: {', '.join(valid_times)}"
            )

        if  not medication.duration or medication.duration < 1:
            raise HTTPException(
                status_code=400,
                detail="Duration must be at least 1 day"
            )

        patient = await db.patients.find_one({
            "patient_id": medication.patient_id,
            "caretakers": current_user["username"]
        })

        if not patient:
            raise HTTPException(
                status_code=404,
                detail="Patient not found or you don't have permission to prescribe for this patient"
            )

        now = datetime.utcnow()
        new_med = {
            "patient_id": medication.patient_id,
            "doctor_id": current_user["username"],
            "name": medication.name,
            "time": medication.time,
            "duration": medication.duration,
            "notes": medication.notes,
            "created_at": now,
            "expires_at": now + timedelta(days=medication.duration)
        }

        result = await db.medications.insert_one(new_med)
        med_id = str(result.inserted_id)

        await db.patients.update_one(
            {"patient_id": medication.patient_id},
            {"$addToSet": {"medications": med_id}}
        )

        return {
            "id": med_id,
            "patient_id": medication.patient_id,
            "patient_name": patient.get("name", "Unknown"),
            "doctor_id": current_user["username"],
            "name": medication.name,
            "time": medication.time,
            "duration": medication.duration,
            "notes": medication.notes,
            "created_at": now,
            "expires_at": now + timedelta(days=medication.duration)
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create medication: {str(e)}"
        )


@app.delete("/api/medications/{medication_id}")
async def delete_medication(
    medication_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Remove a medication prescription"""
    try:
        # Validate medication_id
        if not medication_id:
            raise HTTPException(status_code=400, detail="Medication ID is required")

        try:
            medication_oid = ObjectId(medication_id)
        except:
            raise HTTPException(status_code=400, detail="Invalid medication ID format")

        # Verify medication exists
        medication = await db.medications.find_one({
            "_id": medication_oid,
            "doctor_id": current_user["username"]
        })
        
        if not medication:
            raise HTTPException(status_code=404, detail="Medication not found")

        # Perform deletion
        await db.medications.delete_one({"_id": medication_oid})
        
        # Remove from patient's medications list
        await db.patients.update_one(
            {"patient_id": medication["patient_id"]},
            {"$pull": {"medications": medication_id}}
        )
        
        return {"success": True, "message": "Medication deleted successfully","deleted_id": medication_id}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Background task to clean expired medications
async def clean_expired_medications():
    """Should be called periodically (e.g., daily)"""
    try:
        now = datetime.utcnow()
        expired_meds = db.medications.find({
            "expires_at": {"$lt": now}
        })
        
        async for med in expired_meds:
            # Remove from patient's medications list
            await db.patients.update_one(
                {"patient_id": med["patient_id"]},
                {"$pull": {"medications": str(med["_id"])}}
            )
            
            # Delete the medication
            await db.medications.delete_one({"_id": med["_id"]})
            
        print(f"Cleaned up expired medications at {now}")
        
    except Exception as e:
        print(f"Error cleaning expired medications: {str(e)}")


@app.get("/generate-sequence")
async def generate_sequence(round_number: int):
    # Determine number of colors based on round
    if round_number <= 5:
        num_colors = 4
    elif round_number <= 10:
        num_colors = 6
    elif round_number <= 15:
        num_colors = 8
    elif round_number <= 20:
        num_colors = 10
    elif round_number <= 23:
        num_colors = 16
    else:
        num_colors = 25
    
    # Generate sequence of taps (length = round number)
    sequence = [random.randint(0, num_colors - 1) for _ in range(round_number)]
    
    return {
        "sequence": sequence,
        "num_colors": num_colors
    }


class GameUser(BaseModel):
    patient_id: str
    name: str
    level: int = 1
    exp: int = 0
    badges: List[str] = Field(default_factory=list)
    games_played: Dict[str, int] = Field(default_factory=dict)
    created_at: datetime = datetime.utcnow()
    last_played: Optional[datetime] = None
    current_streak: int = 0  # Current consecutive days
    longest_streak: int = 0  # All-time record
    last_login_date: Optional[str] = None  # YYYY-MM-DD format


# Add these endpoints
@app.post("/api/game_user/initialize")
async def initialize_game_user(
    patient_id: str = Form(...),
    name: str = Form(...),
    current_user: dict = Depends(get_current_user)
):
    """Initialize a game user profile if it doesn't exist"""
    try:
        # Check if patient exists and user has access
        patient = await db.patients.find_one({
            "patient_id": patient_id,
            "$or": [
                {"user_id": current_user["username"]},
                {"caretakers": current_user["username"]}
            ]
        })
        
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found or access denied")

        # Check if game user already exists
        existing = await db.game_users.find_one({"patient_id": patient_id})
        if existing:
            return convert_mongo_doc(existing)

        # Create new game user
        game_user = {
            "patient_id": patient_id,
            "name": name,
            "level": 1,
            "exp": 0,
            "badges": [],
            "games_played": {},
            "created_at": datetime.utcnow()
        }

        result = await db.game_users.insert_one(game_user)
        game_user["_id"] = result.inserted_id
        
        return convert_mongo_doc(game_user)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/game_user/{patient_id}")
async def get_game_user(
    patient_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get game user profile"""
    try:
        print(f"Fetching game user for patient: {patient_id}")
        print(f"Current user: {current_user['username']}")

        # Verify patient exists and user has access - using same logic as patient_stats
        patient = await db.patients.find_one({
            "$or": [
                {"user_id": current_user["username"]},
                {"caretakers": current_user["username"]},
                {"patient_id": current_user["username"]}
            ],
            "patient_id": patient_id  # Also ensure we're getting the requested patient
        })
        
        if not patient:
            print(f"Patient {patient_id} not found or access denied for user {current_user['username']}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Patient not found or access denied"
            )

        # Check for existing game user
        game_user = await db.game_users.find_one({"patient_id": patient_id})
        
        if not game_user:
            print(f"Creating new game user for patient {patient_id}")
            game_user = {
                "patient_id": patient_id,
                "name": patient.get("name", "Player"),
                "level": 1,
                "exp": 0,
                "badges": [],
                "games_played": {},
                "created_at": datetime.utcnow()
            }
            
            try:
                result = await db.game_users.insert_one(game_user)
                game_user["_id"] = result.inserted_id
                print(f"Created new game user: {game_user}")
            except Exception as insert_error:
                print(f"Error creating game user: {str(insert_error)}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to create game profile"
                )

        return convert_mongo_doc(game_user)
        
    except HTTPException:
        # Re-raise HTTPExceptions (like our 404)
        raise
    except Exception as e:
        print(f"ERROR in get_game_user: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

class Score(BaseModel):
    patient_id: str
    game_name: str
    score: int
    rounds_completed: int
    date: datetime = Field(default_factory=datetime.utcnow)
    is_high_score: bool = False

class PatientStatsResponse(BaseModel):
    patient: dict
    stats: dict
    
    class Config:
        json_encoders = {
            ObjectId: str,
            datetime: lambda v: v.isoformat()
        }


@app.post("/api/save-score")
async def save_score(score_data: dict, current_user: dict = Depends(get_current_user)):
    try:
        print(f"\n=== Saving score for user {current_user['username']} ===")
        print(f"Score data received: {score_data}")
        
        # Get patient ID
        patient = await db.patients.find_one({
            "$or": [
                {"user_id": current_user["username"]},
                {"caretakers": current_user["username"]},
                {"patient_id": current_user["username"]}
            ]
        })
        
        if not patient:
            print(f"No patient found for user {current_user['username']}")
            raise HTTPException(status_code=404, detail="Patient not found")
            
        patient_id = patient["patient_id"]
        print(f"Found patient ID: {patient_id}")
        
        # Get current date in YYYY-MM-DD format
        current_date = datetime.utcnow()
        date_str = current_date.strftime("%Y-%m-%d")
        
        # Format the score document
        score_doc = {
            "patient_id": patient_id,
            "game_name": score_data["game_name"],
            "score": int(score_data["score"]),
            "rounds_completed": int(score_data["rounds_completed"]),
            "completed": int(score_data["rounds_completed"]),  # For attention calculation
            "total": int(score_data["rounds_completed"]),      # For attention calculation
            "time": score_data.get("time", 180),  # Default to 3 minutes if not provided
            "date": date_str,                     # Store as YYYY-MM-DD string
            "created_at": current_date,           # Store full datetime
            "session_id": f"{date_str}-{patient_id}-{score_data['game_name']}",  # Track unique sessions
        }
        
        # Check if this is a high score
        existing_high_score = await db.scores.find_one(
            {
                "patient_id": patient_id,
                "game_name": score_data["game_name"]
            },
            sort=[("score", -1)]
        )
        
        score_doc["is_high_score"] = not existing_high_score or score_doc["score"] > existing_high_score["score"]
        
        print(f"Saving score document: {score_doc}")
        result = await db.scores.insert_one(score_doc)
        print(f"Score saved with ID: {result.inserted_id}")
        
        # Update game user stats with session tracking
        update_data = {
            "$inc": {
                f"games_played.{score_data['game_name']}": 1,
                "daily_sessions": 1
            },
            "$set": {
                "last_played": current_date,
                "last_session_date": date_str
            }
        }
        
        await db.game_users.update_one(
            {"patient_id": patient_id},
            update_data,
            upsert=True
        )
        
        return {"message": "Score saved successfully", "score_id": str(result.inserted_id)}
        
    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"Error saving score: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save score: {str(e)}")
    finally:
        print("=== Score saving completed ===\n")

@app.post("/api/save-memory-score")
async def save_memory_score(
    score_data: dict,
    current_user: dict = Depends(get_current_user)
):
    """Save score for memory matching game with level-based difficulty"""
    try:
        # Validate input
        required_fields = ["score", "base_score", "level", "time", "matches", "moves", "difficulty", "time_limit", "time_bonus"]
        if not all(key in score_data for key in required_fields):
            raise HTTPException(
                status_code=400, 
                detail=f"Missing required fields. Required: {required_fields}, Received: {score_data.keys()}"
            )

        # Get current date in YYYY-MM-DD format
        current_date = datetime.utcnow()
        date_str = current_date.strftime("%Y-%m-%d")

        # Save the score document with all details
        score_doc = {
            "patient_id": current_user["username"],
            "game_name": "memory_match",
            "score": score_data["score"],  # Final score including bonus
            "base_score": score_data["base_score"],
            "time_bonus": score_data["time_bonus"],
            "level": score_data["level"],
            "difficulty": score_data["difficulty"],
            "time": score_data["time"],
            "time_limit": score_data["time_limit"],
            "matches": score_data["matches"],
            "moves": score_data["moves"],
            "completed": score_data["matches"],  # For attention calculation
            "total": score_data["matches"],      # For attention calculation
            "date": date_str,                    # Store as YYYY-MM-DD string
            "created_at": current_date,          # Store full datetime
            "session_id": f"{date_str}-{current_user['username']}-memory_match",  # Track unique sessions
            "is_high_score": False  # Will be updated below
        }
        
        # Check if this is a new high score
        high_score = await db.scores.find_one(
            {
                "patient_id": current_user["username"],
                "game_name": "memory_match",
                "difficulty": score_data["difficulty"]
            },
            sort=[("score", -1)]
        )

        score_doc["is_high_score"] = not high_score or score_data["score"] > high_score["score"]
        
        # Insert into database
        result = await db.scores.insert_one(score_doc)

        # Update player profile with session tracking
        update_data = {
            "$inc": {
                "games_played.memory_match": 1,
                "daily_sessions": 1
            },
            "$set": {
                "last_played": current_date,
                "last_session_date": date_str
            }
        }

        await db.game_users.update_one(
            {"patient_id": current_user["username"]},
            update_data,
            upsert=True
        )

        return {
            "success": True,
            "score_id": str(result.inserted_id),
            "is_high_score": score_doc["is_high_score"]
        }

    except Exception as e:
        print(f"Error saving score: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to save score: {str(e)}"
        )

async def fix_user_exp_and_level(game_user: dict) -> dict:
    """Helper function to fix user exp and level"""
    try:
        current_level = game_user.get("level", 1)
        current_exp = game_user.get("exp", 0)
        original_level = current_level
        original_exp = current_exp
        
        # Calculate required exp for current level
        exp_needed = current_level * 100
        
        # Level up while exp exceeds requirement
        while current_exp >= exp_needed:
            current_exp -= exp_needed
            current_level += 1
            exp_needed = current_level * 100
        
        # Only update if values changed
        if current_level != original_level or current_exp != original_exp:
            await db.game_users.update_one(
                {"_id": game_user["_id"]},
                {
                    "$set": {
                        "level": current_level,
                        "exp": current_exp
                    }
                }
            )
            
            # Add missing level badges
            if current_level > original_level:
                new_badges = [f"Level {level} Achiever" for level in range(original_level + 1, current_level + 1)]
                if new_badges:
                    await db.game_users.update_one(
                        {"_id": game_user["_id"]},
                        {"$addToSet": {"badges": {"$each": new_badges}}}
                    )
            
            game_user["level"] = current_level
            game_user["exp"] = current_exp
        
        # Calculate and add exp progress
        exp_needed = current_level * 100
        exp_progress = (current_exp / exp_needed) * 100 if exp_needed > 0 else 0
        game_user["exp_needed"] = exp_needed
        game_user["exp_progress"] = round(exp_progress, 1)
        
        return game_user
    except Exception as e:
        print(f"Error fixing user exp: {str(e)}")
        return game_user

@app.get("/api/game_user/current")
async def get_current_game_user(current_user: dict = Depends(get_current_user)):
    """Get the current user's game profile with proper EXP handling"""
    try:
        patient_id = current_user["username"]
        
        game_user = await db.game_users.find_one({"patient_id": patient_id})
        if not game_user:
            # Create a default profile if none exists
            game_user = {
                "patient_id": patient_id,
                "name": current_user.get("name", "Player"),
                "level": 1,
                "exp": 0,
                "badges": [],
                "games_played": {},
                "created_at": datetime.utcnow(),
                "last_played": None,
                "current_streak": 0,
                "longest_streak": 0,
                "exp_needed": 100,
                "exp_progress": 0
            }
            await db.game_users.insert_one(game_user)
            return convert_mongo_doc(game_user)
        
        # Fix exp and level if needed
        game_user = await fix_user_exp_and_level(game_user)
        
        return convert_mongo_doc(game_user)
    except Exception as e:
        print(f"Error in get_current_game_user: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/fix_all_user_exp")
async def fix_all_user_exp(current_user: dict = Depends(get_current_user)):
    """Admin endpoint to fix all user exp and levels"""
    try:
        if current_user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin access required")
        
        fixed_count = 0
        async for game_user in db.game_users.find():
            try:
                await fix_user_exp_and_level(game_user)
                fixed_count += 1
            except Exception as e:
                print(f"Error fixing user {game_user.get('patient_id')}: {str(e)}")
                continue
        
        return {"message": f"Fixed {fixed_count} user profiles"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/high-scores")
async def get_patient_high_scores(game_name: str = None, current_user: dict = Depends(get_current_user)):
    """Get high scores for the current user's patient"""
    try:
        # Get patient ID for the current user
        patient = await db.patients.find_one({
            "$or": [
                {"user_id": current_user["username"]},
                {"caretakers": current_user["username"]},
                {"patient_id": current_user["username"]}
            ]
        })
        
        if not patient:
            return JSONResponse(
                status_code=200,
                content={"scores": []}
            )
        
        # Build query
        query = {"patient_id": patient["patient_id"]}
        if game_name:
            query["game_name"] = game_name
        
        # Get top 10 scores for this patient
        scores = await db.scores.find(
            query,
            {"_id": 0, "game_name": 1, "score": 1, "date": 1, "is_high_score": 1}
        ).sort("score", -1).limit(10).to_list(None)
        
        return {"scores": scores or []}
        
    except Exception as e:
        return JSONResponse(
            status_code=200,
            content={"scores": []}
        )


@app.get("/api/memory-high-scores")
async def get_memory_high_scores(
    difficulty: Optional[str] = None,
    limit: int = 10,
    current_user: dict = Depends(get_current_user)
):
    """Get high scores for memory matching game, optionally filtered by difficulty"""
    try:
        query = {
            "patient_id": current_user["username"],
            "game_name": "memory_match"
        }
        
        if difficulty:
            query["difficulty"] = difficulty
        
        scores = await db.scores.find(
            query,
            {
                "_id": 0,
                "score": 1,
                "level": 1,
                "difficulty": 1,
                "time": 1,
                "time_limit": 1,
                "matches": 1,
                "moves": 1,
                "date": 1
            }
        ).sort([("score", -1), ("time", 1)]).limit(limit).to_list(None)
        
        return {"scores": scores or []}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str
    timestamp: Optional[str] = None

class ChatRequest(BaseModel):
    message: str
    chat_history: Optional[List[ChatMessage]] = None

class ChatResponse(BaseModel):
    response: str
    emotion: Optional[str] = None

@router.post("/api/chat", response_model=ChatResponse)
async def chat_with_bot(request: ChatRequest):
    try:
        response = chatbot_instance.generate_response(request.message)
        
        # Get the dominant emotion from the last classification
        emotions = chatbot_instance.classify_emotion(request.message)
        dominant_emotion = emotions[0]["label"] if emotions else "neutral"
        
        return {
            "response": response,
            "emotion": dominant_emotion
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Include the router in your FastAPI app
app.include_router(router)

@app.post("/api/notifications/{notification_id}/remind-later")
async def remind_later_notification(
    notification_id: str,
    current_user: dict = Depends(get_current_user)
):
    try:
        # Get the original notification
        notification = await db.notifications.find_one({
            "_id": ObjectId(notification_id),
            "user_id": current_user["username"]
        })
        
        if not notification:
            raise HTTPException(status_code=404, detail="Notification not found")
            
        if not notification.get("remind_later"):
            raise HTTPException(status_code=400, detail="Notification cannot be reminded later")
            
        # Mark original as read
        await db.notifications.update_one(
            {"_id": ObjectId(notification_id)},
            {"$set": {"read": True}}
        )
        
        # Schedule a new notification for 15 minutes later
        remind_time = datetime.utcnow() + timedelta(minutes=15)
        
        # If it's an appointment notification, get the appointment details
        if notification["type"] == "appointment":
            appointment = await db.appointments.find_one({
                "_id": ObjectId(notification["related_id"])
            })
            
            if appointment:
                appt_time = datetime.strptime(f"{appointment['date']} {appointment['time']}", "%Y-%m-%d %H:%M")
                time_until = appt_time - remind_time
                minutes_until = max(0, int(time_until.total_seconds() / 60))
                
                message = f"Reminder: You have an appointment in {minutes_until} minutes: {appointment.get('description', 'No description')}"
                
                await create_notification(
                    user_id=current_user["username"],
                    message=message,
                    notification_type="appointment",
                    related_id=notification["related_id"]
                )
                
        return {"success": True, "message": "Reminder scheduled for 15 minutes later"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    current_user: dict = Depends(get_current_user)
):
    try:
        # Handle appointment notification IDs which use a custom format
        if notification_id.startswith('appointment-'):
            # For appointment notifications, use the full ID as is
            result = await db.notifications.update_one(
                {
                    "type": "appointment",
                    "related_id": notification_id.replace('appointment-', ''),
                    "user_id": current_user["username"]
                },
                {"$set": {"read": True}}
            )
        else:
            # For regular notifications, try to convert to ObjectId
            try:
                obj_id = ObjectId(notification_id)
                result = await db.notifications.update_one(
                    {"_id": obj_id, "user_id": current_user["username"]},
                    {"$set": {"read": True}}
                )
            except InvalidId:
                raise HTTPException(status_code=400, detail="Invalid notification ID format")
        
        if result.modified_count == 0:
            raise HTTPException(status_code=404, detail="Notification not found")
            
        return {"success": True, "message": "Notification marked as read"}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error marking notification as read: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to mark notification as read")

@app.get("/api/notifications/unread-count")
async def get_unread_notification_count(current_user: dict = Depends(get_current_user)):
    try:
        count = await db.notifications.count_documents({
            "user_id": current_user["username"],
            "read": False
        })
        
        return {"count": count}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/daily-login")
async def record_daily_login(current_user: dict = Depends(get_current_user)):
    try:
        today = datetime.utcnow().date().isoformat()  # Get date in YYYY-MM-DD format
        
        # Get or create game user
        game_user = await db.game_users.find_one({"patient_id": current_user["username"]})
        if not game_user:
            # Create new game user if doesn't exist
            game_user = {
                "patient_id": current_user["username"],
                "name": current_user.get("name", "Player"),
                "level": 1,
                "exp": 0,
                "badges": [],
                "games_played": {},
                "created_at": datetime.utcnow(),
                "current_streak": 0,
                "longest_streak": 0,
                "last_login_date": None
            }
            await db.game_users.insert_one(game_user)
            return {
                "success": True,
                "current_streak": 0,
                "longest_streak": 0,
                "message": "New user created"
            }
        
        # Check if already logged in today
        if game_user.get("last_login_date") == today:
            return {
                "success": True,
                "current_streak": game_user.get("current_streak", 0),
                "longest_streak": game_user.get("longest_streak", 0),
                "message": "Already logged in today"
            }
        
        # Calculate new streak
        new_streak = 1  # Default to 1 if no previous login
        if game_user.get("last_login_date"):
            last_login = datetime.strptime(game_user["last_login_date"], "%Y-%m-%d").date()
            current_date = datetime.utcnow().date()
            delta = (current_date - last_login).days
            
            if delta == 1:
                # Consecutive day
                new_streak = game_user.get("current_streak", 0) + 1
            elif delta == 0:
                # Same day (shouldn't happen due to earlier check)
                new_streak = game_user.get("current_streak", 0)
            else:
                # Broken streak (more than 1 day gap)
                new_streak = 1
        
        # Update longest streak
        longest_streak = max(game_user.get("longest_streak", 0), new_streak)
        
        # Update database
        await db.game_users.update_one(
            {"patient_id": current_user["username"]},
            {
                "$set": {
                    "current_streak": new_streak,
                    "longest_streak": longest_streak,
                    "last_login_date": today
                },
                "$inc": {
                    "exp": 50  # Daily login bonus
                }
            }
        )
        
        return {
            "success": True,
            "current_streak": new_streak,
            "longest_streak": longest_streak,
            "streak_bonus": min(100, new_streak * 10),  # 10% per day, capped at 100%
            "message": "Daily login recorded"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/update_patient_stage")
async def update_patient_stage(
    data: dict,
    current_user: dict = Depends(get_current_user)
):
    try:
        patient_id = data.get("patient_id")
        new_stage = data.get("new_stage")
        
        if not patient_id or new_stage not in ["0", "1", "2", "3", "4"]:
            raise HTTPException(status_code=400, detail="Invalid patient ID or stage")

        # Verify access to patient
        patient = await db.patients.find_one({
            "patient_id": patient_id,
            "$or": [
                {"user_id": current_user["username"]},
                {"caretakers": current_user["username"]}
            ]
        })
        
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found or access denied")

        # Update patient's stage
        await db.patients.update_one(
            {"patient_id": patient_id},
            {"$set": {
                "alzheimer_stage": new_stage,
                "last_stage_update": datetime.utcnow()
            }}
        )

        # Update game settings based on stage
        game_settings = {
            "0": {"difficulty": "hard", "time_limit": 120, "hints_allowed": False},
            "1": {"difficulty": "medium", "time_limit": 150, "hints_allowed": False},
            "2": {"difficulty": "medium", "time_limit": 180, "hints_allowed": True},
            "3": {"difficulty": "easy", "time_limit": 240, "hints_allowed": True},
            "4": {"difficulty": "very_easy", "time_limit": 300, "hints_allowed": True}
        }

        # Update game user settings
        await db.game_users.update_one(
            {"patient_id": patient_id},
            {"$set": {
                "current_settings": game_settings[new_stage],
                "stage_updated_at": datetime.utcnow()
            }}
        )

        # Create notification for the change
        stage_names = {
            "0": "Non-demented",
            "1": "Very Mild",
            "2": "Mild",
            "3": "Moderate",
            "4": "Severe"
        }

        notification_message = f"Treatment plan updated to {stage_names[new_stage]}. Game settings have been adjusted accordingly."
        
        await create_notification(
            user_id=patient["user_id"],
            message=notification_message,
            notification_type="treatment_update",
            related_id=patient_id
        )

        # If patient has caretakers, notify them too
        if patient.get("caretakers"):
            for caretaker in patient["caretakers"]:
                await create_notification(
                    user_id=caretaker,
                    message=notification_message,
                    notification_type="treatment_update",
                    related_id=patient_id
                )

        return {"message": "Treatment plan updated successfully"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def generate_report_for_patient(patient_id: str):
    """Helper function to generate report for a specific patient"""
    try:
        print(f"Starting report generation for patient: {patient_id}")
        
        # Get patient data
        patient = await db.patients.find_one({"patient_id": patient_id})
        if not patient:
            raise ValueError(f"Patient {patient_id} not found")
        
        # Calculate date ranges
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=7)
        prev_start_date = start_date - timedelta(days=7)
        
        # Convert dates to strings in YYYY-MM-DD format for comparison
        end_date_str = end_date.strftime("%Y-%m-%d")
        start_date_str = start_date.strftime("%Y-%m-%d")
        prev_start_date_str = prev_start_date.strftime("%Y-%m-%d")
        
        print(f"\nQuerying scores for period: {start_date_str} to {end_date_str}")
        
        # Helper function to normalize date for comparison
        def normalize_date(score):
            date = score.get('date')
            if isinstance(date, datetime):
                return date.strftime("%Y-%m-%d")
            return date if isinstance(date, str) else None
        
        # Get all scores and filter by date
        all_scores = await db.scores.find({"patient_id": patient_id}).to_list(None)
        print(f"\nFound {len(all_scores)} total scores")
        
        # Filter scores by date range
        current_week_scores = [
            score for score in all_scores 
            if normalize_date(score) and start_date_str <= normalize_date(score) <= end_date_str
        ]
        
        prev_week_scores = [
            score for score in all_scores 
            if normalize_date(score) and prev_start_date_str <= normalize_date(score) < start_date_str
        ]
        
        print(f"\nAfter date filtering:")
        print(f"Current period ({start_date_str} to {end_date_str}): {len(current_week_scores)} scores")
        for score in current_week_scores:
            print(f"Score: {score.get('score')}, Date: {normalize_date(score)}, Game: {score.get('game_name')}")
        
        print(f"\nPrevious period ({prev_start_date_str} to {start_date_str}): {len(prev_week_scores)} scores")
        for score in prev_week_scores:
            print(f"Score: {score.get('score')}, Date: {normalize_date(score)}, Game: {score.get('game_name')}")
        
        # Calculate metrics
        engagement = await calculate_engagement(current_week_scores, prev_week_scores)
        improvement = await calculate_improvement(current_week_scores, prev_week_scores)
        efficiency = await calculate_efficiency(current_week_scores)
        attention = await calculate_attention(current_week_scores)
        
        # Format games data
        games = []
        game_scores = {}
        for score in current_week_scores:
            game_name = score["game_name"]
            if game_name not in game_scores:
                game_scores[game_name] = []
            game_scores[game_name].append(score)
        
        for game_name, scores in game_scores.items():
            game_data = {
                "name": game_name,
                "sessions": len(scores),
                "high_score": max(s["score"] for s in scores),
                "average_score": sum(s["score"] for s in scores) / len(scores),
                "total_rounds": sum(s.get("rounds_completed", 0) for s in scores),
                "scores": sorted(scores, key=lambda x: normalize_date(x))
            }
            games.append(game_data)
        
        # Get high scores
        high_scores = {}
        for game in ["memotap", "memory_match", "pattern_recognition"]:
            game_scores = [s for s in all_scores if s["game_name"] == game]
            if game_scores:
                high_score = max(game_scores, key=lambda x: x["score"])
                high_scores[game] = {
                    "score": high_score["score"],
                    "date": normalize_date(high_score),
                    "details": high_score
                }
            else:
                high_scores[game] = {
                    "score": 0,
                    "date": end_date_str,
                    "details": {"score": 0, "date": end_date_str, "rounds_completed": 0}
                }
        
        # Get streaks
        game_user = await db.game_users.find_one({"patient_id": patient_id})
        streaks = {
            "current_streak": game_user.get("current_streak", 0) if game_user else 0,
            "longest_streak": game_user.get("longest_streak", 0) if game_user else 0,
            "last_login": game_user.get("last_login_date") if game_user else None
        }
        
        report = {
            "patient_id": patient_id,
            "patient_name": patient.get("name", "Unknown"),
            "generated_at": datetime.utcnow(),
            "period": {
                "start": start_date,
                "end": end_date
            },
            "engagement": engagement,
            "improvement": improvement,
            "efficiency": efficiency,
            "attention": attention,
            "games": games,
            "high_scores": high_scores,
            "streaks": streaks
        }
        
        print("\nReport generated successfully")
        return report
        
    except Exception as e:
        print(f"Error generating report: {str(e)}")
        raise e

async def calculate_engagement(current_scores, prev_scores):
    """Calculate engagement metrics with better handling of empty data"""
    try:
        # Get unique game sessions by grouping scores by date and game
        current_sessions = len(set([(s.get("date", "").split("T")[0], s.get("game_name")) for s in current_scores]))
        prev_sessions = len(set([(s.get("date", "").split("T")[0], s.get("game_name")) for s in prev_scores])) if prev_scores else 0
        
        # Calculate trend
        if current_sessions == 0 and prev_sessions == 0:
            trend = "→"
        else:
            trend = "↑" if current_sessions > prev_sessions else "↓" if current_sessions < prev_sessions else "→"
        
        # Calculate percent change
        if prev_sessions > 0:
            percent_change = ((current_sessions - prev_sessions) / prev_sessions) * 100
        elif current_sessions > 0:
            percent_change = 100  # First-time engagement
        else:
            percent_change = 0
        
        return {
            "sessions": current_sessions,
            "previous_sessions": prev_sessions,
            "trend": trend,
            "change": abs(current_sessions - prev_sessions),
            "percent_change": round(percent_change, 1)
        }
    except Exception as e:
        print(f"Error calculating engagement: {str(e)}")
        return {
            "sessions": 0,
            "previous_sessions": 0,
            "trend": "→",
            "change": 0,
            "percent_change": 0
        }

async def calculate_improvement(current_scores, prev_scores):
    """Calculate improvement metrics with better handling of empty data"""
    try:
        if not current_scores:
            return {
                "percentage": 0.0,
                "games_improved": 0,
                "games_declined": 0,
                "games_with_data": 0,
                "game_details": {},
                "cognitive_domains": {}
            }
        
        # Group scores by game
        current_games = {}
        prev_games = {}
        
        for score in current_scores:
            game_name = score["game_name"]
            if game_name not in current_games:
                current_games[game_name] = []
            current_games[game_name].append(score)
        
        for score in (prev_scores or []):
            game_name = score["game_name"]
            if game_name not in prev_games:
                prev_games[game_name] = []
            prev_games[game_name].append(score)
        
        improvements = []
        game_details = {}
        
        for game_name, scores in current_games.items():
            avg_score = sum(s["score"] for s in scores) / len(scores)
            prev_avg = 0
            if game_name in prev_games:
                prev_scores = prev_games[game_name]
                if prev_scores:
                    prev_avg = sum(s["score"] for s in prev_scores) / len(prev_scores)
            
            improvement = ((avg_score - prev_avg) / prev_avg * 100) if prev_avg > 0 else 0
            improvements.append(improvement)
            
            game_details[game_name] = {
                "current_avg": avg_score,
                "previous_avg": prev_avg,
                "improvement": improvement,
                "sessions": len(scores)
            }
        
        overall_improvement = sum(improvements) / len(improvements) if improvements else 0
        
        return {
            "percentage": round(overall_improvement, 1),
            "games_improved": len([i for i in improvements if i > 0]),
            "games_declined": len([i for i in improvements if i < 0]),
            "games_with_data": len(improvements),
            "game_details": game_details
        }
    except Exception as e:
        print(f"Error calculating improvement: {str(e)}")
        return {
            "percentage": 0.0,
            "games_improved": 0,
            "games_declined": 0,
            "games_with_data": 0,
            "game_details": {}
        }

async def calculate_efficiency(current_scores):
    """Calculate efficiency metrics with better handling of empty data"""
    try:
        if not current_scores:
            return {
                "ratio": 0,
                "avg_completion_time": 0,
                "moves_per_match": 0,
                "trend": "→",
                "interpretation": "No game data available"
            }
        
        total_moves = 0
        total_matches = 0
        total_time = 0
        games_with_data = 0
        
        for score in current_scores:
            if "moves" in score and "matches" in score:
                total_moves += score["moves"]
                total_matches += score["matches"]
                games_with_data += 1
            if "time" in score:
                total_time += score["time"]
        
        if games_with_data == 0:
            return {
                "ratio": 0,
                "avg_completion_time": 0,
                "moves_per_match": 0,
                "trend": "→",
                "interpretation": "No game data available"
            }
        
        ratio = total_matches / total_moves if total_moves > 0 else 0
        avg_time = total_time / games_with_data if games_with_data > 0 else 0
        moves_per_match = total_moves / total_matches if total_matches > 0 else 0
        
        return {
            "ratio": round(ratio, 2),
            "avg_completion_time": round(avg_time, 1),
            "moves_per_match": round(moves_per_match, 1),
            "trend": "↑" if ratio > 0.5 else "↓" if ratio < 0.3 else "→",
            "interpretation": get_efficiency_interpretation(ratio)
        }
    except Exception as e:
        print(f"Error calculating efficiency: {str(e)}")
        return {
            "ratio": 0,
            "avg_completion_time": 0,
            "moves_per_match": 0,
            "trend": "→",
            "interpretation": "Error calculating efficiency"
        }

async def calculate_attention(current_scores):
    """Calculate attention metrics with better handling of empty data"""
    try:
        if not current_scores:
            return {
                "average_time": 0,
                "completion_rate": 0,
                "focus_score": 0,
                "interpretation": "No game data available"
            }
        
        total_time = 0
        total_completed = 0
        total_attempts = 0
        games_with_data = 0
        
        for score in current_scores:
            if "time" in score:
                total_time += score["time"]
                games_with_data += 1
            if "completed" in score and "total" in score:
                total_completed += score["completed"]
                total_attempts += score["total"]
        
        avg_time = total_time / games_with_data if games_with_data > 0 else 0
        completion_rate = (total_completed / total_attempts * 100) if total_attempts > 0 else 0
        focus_score = min(100, (avg_time / 60) * (completion_rate / 100) * 100) if avg_time > 0 else 0
        
        return {
            "average_time": round(avg_time, 1),
            "completion_rate": round(completion_rate, 1),
            "focus_score": round(focus_score, 1),
            "interpretation": get_attention_interpretation(focus_score)
        }
    except Exception as e:
        print(f"Error calculating attention: {str(e)}")
        return {
            "average_time": 0,
            "completion_rate": 0,
            "focus_score": 0,
            "interpretation": "Error calculating attention metrics"
        }

def get_efficiency_interpretation(ratio):
    """Get interpretation of efficiency ratio"""
    if ratio >= 0.8:
        return "Excellent efficiency - maintaining high accuracy with minimal moves"
    elif ratio >= 0.6:
        return "Good efficiency - consistent performance with room for improvement"
    elif ratio >= 0.4:
        return "Moderate efficiency - consider focusing on accuracy over speed"
    else:
        return "Needs improvement - try taking more time to plan moves"

def get_attention_interpretation(score):
    """Get interpretation of attention score"""
    if score >= 90:
        return "Excellent sustained attention and task completion"
    elif score >= 75:
        return "Good attention with consistent focus"
    elif score >= 60:
        return "Moderate attention - consider shorter, more focused sessions"
    elif score >= 40:
        return "Variable attention - try using memory aids and taking breaks"
    else:
        return "Attention needs improvement - recommend shorter, more frequent sessions"

@app.get("/api/reports/latest")
async def get_latest_report(current_user: dict = Depends(get_current_user)):
    """Get the latest generated report"""
    try:
        print(f"Fetching latest report for user: {current_user['username']}")
        
        # Get patient ID for the current user
        patient = await db.patients.find_one({
            "$or": [
                {"user_id": current_user["username"]},
                {"caretakers": current_user["username"]},
                {"patient_id": current_user["username"]}
            ]
        })
        
        if not patient:
            print(f"No patient found for user: {current_user['username']}")
            raise HTTPException(status_code=404, detail="Patient not found")
        
        print(f"Found patient: {patient['patient_id']}")
        
        # Get the latest report
        report = await db.reports.find_one(
            {"patient_id": patient["patient_id"]},
            sort=[("generated_at", -1)]
        )
        
        if not report:
            print(f"No existing report found, generating new report for patient: {patient['patient_id']}")
            try:
                # Generate new report
                report = await generate_report_for_patient(patient["patient_id"])
                if report:
                    # Store the report
                    report["created_at"] = datetime.utcnow()
                    report["type"] = "on_demand"
                    report["requested_by"] = current_user["username"]
                    await db.reports.insert_one(report)
                    print("New report generated and stored successfully")
                else:
                    raise Exception("Report generation returned None")
            except Exception as e:
                print(f"Error generating report: {str(e)}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to generate report: {str(e)}"
                )
        
        return convert_mongo_doc(report)
        
    except HTTPException as he:
        print(f"HTTP Exception in get_latest_report: {he.detail}")
        raise he
    except Exception as e:
        print(f"Unexpected error in get_latest_report: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"An unexpected error occurred: {str(e)}"
        )

async def generate_report_for_patient(patient_id: str):
    """Helper function to generate report for a specific patient"""
    try:
        print(f"Starting report generation for patient: {patient_id}")
        
        # Get patient data
        patient = await db.patients.find_one({"patient_id": patient_id})
        if not patient:
            raise ValueError(f"Patient {patient_id} not found")
        
        # Calculate date ranges
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=7)
        prev_start_date = start_date - timedelta(days=7)
        
        # Convert dates to strings in YYYY-MM-DD format for comparison
        end_date_str = end_date.strftime("%Y-%m-%d")
        start_date_str = start_date.strftime("%Y-%m-%d")
        prev_start_date_str = prev_start_date.strftime("%Y-%m-%d")
        
        print(f"\nQuerying scores for period: {start_date_str} to {end_date_str}")
        
        # Helper function to normalize date for comparison
        def normalize_date(score):
            date = score.get('date')
            if isinstance(date, datetime):
                return date.strftime("%Y-%m-%d")
            return date if isinstance(date, str) else None
        
        # Get all scores and filter by date
        all_scores = await db.scores.find({"patient_id": patient_id}).to_list(None)
        print(f"\nFound {len(all_scores)} total scores")
        
        # Filter scores by date range
        current_week_scores = [
            score for score in all_scores 
            if normalize_date(score) and start_date_str <= normalize_date(score) <= end_date_str
        ]
        
        prev_week_scores = [
            score for score in all_scores 
            if normalize_date(score) and prev_start_date_str <= normalize_date(score) < start_date_str
        ]
        
        print(f"\nAfter date filtering:")
        print(f"Current period ({start_date_str} to {end_date_str}): {len(current_week_scores)} scores")
        for score in current_week_scores:
            print(f"Score: {score.get('score')}, Date: {normalize_date(score)}, Game: {score.get('game_name')}")
        
        print(f"\nPrevious period ({prev_start_date_str} to {start_date_str}): {len(prev_week_scores)} scores")
        for score in prev_week_scores:
            print(f"Score: {score.get('score')}, Date: {normalize_date(score)}, Game: {score.get('game_name')}")
        
        # Calculate metrics
        engagement = await calculate_engagement(current_week_scores, prev_week_scores)
        improvement = await calculate_improvement(current_week_scores, prev_week_scores)
        efficiency = await calculate_efficiency(current_week_scores)
        attention = await calculate_attention(current_week_scores)
        
        # Format games data
        games = []
        game_scores = {}
        for score in current_week_scores:
            game_name = score["game_name"]
            if game_name not in game_scores:
                game_scores[game_name] = []
            game_scores[game_name].append(score)
        
        for game_name, scores in game_scores.items():
            game_data = {
                "name": game_name,
                "sessions": len(scores),
                "high_score": max(s["score"] for s in scores),
                "average_score": sum(s["score"] for s in scores) / len(scores),
                "total_rounds": sum(s.get("rounds_completed", 0) for s in scores),
                "scores": sorted(scores, key=lambda x: normalize_date(x))
            }
            games.append(game_data)
        
        # Get high scores
        high_scores = {}
        for game in ["memotap", "memory_match", "pattern_recognition"]:
            game_scores = [s for s in all_scores if s["game_name"] == game]
            if game_scores:
                high_score = max(game_scores, key=lambda x: x["score"])
                high_scores[game] = {
                    "score": high_score["score"],
                    "date": normalize_date(high_score),
                    "details": high_score
                }
            else:
                high_scores[game] = {
                    "score": 0,
                    "date": end_date_str,
                    "details": {"score": 0, "date": end_date_str, "rounds_completed": 0}
                }
        
        # Get streaks
        game_user = await db.game_users.find_one({"patient_id": patient_id})
        streaks = {
            "current_streak": game_user.get("current_streak", 0) if game_user else 0,
            "longest_streak": game_user.get("longest_streak", 0) if game_user else 0,
            "last_login": game_user.get("last_login_date") if game_user else None
        }
        
        report = {
            "patient_id": patient_id,
            "patient_name": patient.get("name", "Unknown"),
            "generated_at": datetime.utcnow(),
            "period": {
                "start": start_date,
                "end": end_date
            },
            "engagement": engagement,
            "improvement": improvement,
            "efficiency": efficiency,
            "attention": attention,
            "games": games,
            "high_scores": high_scores,
            "streaks": streaks
        }
        
        print("\nReport generated successfully")
        return report
        
    except Exception as e:
        print(f"Error generating report: {str(e)}")
        raise e

async def generate_weekly_reports():
    """Generate weekly reports for all patients"""
    try:
        print(f"[{datetime.now().isoformat()}] Starting weekly report generation")
        
        # Get all patients
        patients = await db.patients.find().to_list(None)
        
        for patient in patients:
            try:
                # Generate report for each patient
                report = await generate_report_for_patient(patient["patient_id"])
                
                # Store in database
                await db.reports.insert_one({
                    **report,
                    "type": "weekly",
                    "generated_at": datetime.utcnow()
                })
                
                print(f"Generated report for patient {patient['patient_id']}")
                
            except Exception as e:
                print(f"Error generating report for patient {patient['patient_id']}: {str(e)}")
                continue
                
        print(f"[{datetime.now().isoformat()}] Completed weekly report generation")
        
    except Exception as e:
        print(f"Error in weekly report generation: {str(e)}")

@app.get("/api/reports/latest")
async def get_latest_report(current_user: dict = Depends(get_current_user)):
    try:
        # Get patient ID for the current user
        patient = await db.patients.find_one({
            "$or": [
                {"user_id": current_user["username"]},
                {"caretakers": current_user["username"]},
                {"patient_id": current_user["username"]}
            ]
        })
        
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found")
        
        # Get the latest report
        report = await db.reports.find_one(
            {"patient_id": patient["patient_id"]},
            sort=[("generated_at", -1)]
        )
        
        if not report:
            raise HTTPException(status_code=404, detail="No reports found")
        
        return convert_mongo_doc(report)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
# Add to your FastAPI backend
class Feedback(BaseModel):
    patient_id: str
    rating: int = Field(..., ge=1, le=5)  # 1-5 stars
    comments: Optional[str] = None
    treatment_stage: str

@app.post("/api/feedback")
async def submit_feedback(
    feedback: Feedback,
    current_user: dict = Depends(get_current_user)
):
    try:
        # Verify the patient exists and user has access
        patient = await db.patients.find_one({
            "patient_id": feedback.patient_id,
            "$or": [
                {"user_id": current_user["username"]},
                {"caretakers": current_user["username"]}
            ]
        })
        
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found or access denied")

        # Store feedback
        feedback_data = {
            "patient_id": feedback.patient_id,
            "rating": feedback.rating,
            "comments": feedback.comments,
            "treatment_stage": feedback.treatment_stage,
            "submitted_by": current_user["username"],
            "submitted_at": datetime.utcnow()
        }
        
        await db.feedback.insert_one(feedback_data)
        
        # Automatically adjust treatment if rating is low
        if feedback.rating < 3:
            current_stage = feedback.treatment_stage
            stages = ['0', '1', '2', '3', '4']  # From no dementia to severe
            
            if current_stage in stages:
                current_index = stages.index(current_stage)
                if current_index < len(stages) - 1:
                    new_stage = stages[current_index + 1]
                    
                    # Update patient record
                    await db.patients.update_one(
                        {"patient_id": feedback.patient_id},
                        {"$set": {"alzheimer_stage": new_stage}}
                    )
                    
                    # Create notification
                    await create_notification(
                        user_id=current_user["username"],
                        message=f"Treatment plan adjusted to {get_stage_name(new_stage)} based on negative feedback",
                        notification_type="treatment_change"
                    )
        
        return {"success": True, "message": "Feedback submitted"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def get_stage_name(stage: str) -> str:
    stages = {
        '0': 'No Dementia',
        '1': 'Very Mild Dementia',
        '2': 'Mild Dementia',
        '3': 'Moderate Dementia',
        '4': 'Severe Dementia'
    }
    return stages.get(stage, 'Unknown Stage')

@app.get("/api/reports/history")
async def get_report_history(
    skip: int = 0,
    limit: int = 10,
    patient_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get paginated history of reports with optional date filtering"""
    try:
        # Get patient ID if not provided
        if not patient_id:
            patient = await db.patients.find_one({
                "$or": [
                    {"user_id": current_user["username"]},
                    {"caretakers": current_user["username"]},
                    {"patient_id": current_user["username"]}
                ]
            })
            if not patient:
                return {"reports": [], "total": 0, "has_more": False}
            patient_id = patient["patient_id"]
        else:
            # Verify access to specified patient
            patient = await db.patients.find_one({
                "patient_id": patient_id,
                "$or": [
                    {"user_id": current_user["username"]},
                    {"caretakers": current_user["username"]},
                    {"patient_id": current_user["username"]}
                ]
            })
            if not patient:
                raise HTTPException(status_code=404, detail="Patient not found or access denied")

        # Build query
        query = {"patient_id": patient_id}
        if start_date or end_date:
            date_query = {}
            if start_date:
                date_query["$gte"] = datetime.fromisoformat(start_date)
            if end_date:
                date_query["$lte"] = datetime.fromisoformat(end_date)
            if date_query:
                query["generated_at"] = date_query

        # Get total count for pagination
        total_reports = await db.reports.count_documents(query)

        # Get paginated reports
        reports = await db.reports.find(query) \
            .sort("generated_at", -1) \
            .skip(skip) \
            .limit(limit) \
            .to_list(None)

        # Return the reports without generating new ones
        return {
            "reports": [convert_mongo_doc(report) for report in reports],
            "total": total_reports,
            "has_more": total_reports > skip + limit
        }

    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"Error fetching reports: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch reports: {str(e)}"
        )

# Add these before the calculate_improvement function
COGNITIVE_DOMAINS = {
    "memory": ["memory_match", "sequence_recall"],
    "attention": ["focus_task", "reaction_time"],
    "problem_solving": ["puzzle_solve", "pattern_match"],
    "language": ["word_find", "sentence_complete"]
}

def get_attention_interpretation(score):
    """Get interpretation of attention score"""
    if score >= 90:
        return "Excellent sustained attention and task completion"
    elif score >= 75:
        return "Good attention with room for improvement"
    elif score >= 60:
        return "Moderate attention, consider attention-focusing exercises"
    else:
        return "Attention needs improvement, recommend shorter, more frequent sessions"

@app.get("/api/generate_report")
async def generate_report(
    request: Request,
    patient_id: str, 
    current_user: dict = Depends(get_current_user)
):
    try:
        # Check if a report already exists for today
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        tomorrow = today + timedelta(days=1)
        
        existing_report = await db.reports.find_one({
            "patient_id": patient_id,
            "generated_at": {
                "$gte": today,
                "$lt": tomorrow
            }
        })
        
        if existing_report:
            # Return the existing report for today
            return convert_mongo_doc(existing_report)
            
        # If no report exists for today, generate a new one
        report_data = await generate_report_for_patient(patient_id)
        
        if report_data:
            report_data["created_at"] = datetime.utcnow()
            report_data["type"] = "on_demand"
            report_data["requested_by"] = current_user["username"]
            
            # Save the new report
            await db.reports.insert_one(report_data)
            return convert_mongo_doc(report_data)
        else:
            raise HTTPException(
                status_code=404,
                detail="No game data available to generate report"
            )
            
    except Exception as e:
        print(f"Error generating report: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate report: {str(e)}"
        )

@app.get("/api/user_patients")
async def get_user_patients(current_user: dict = Depends(get_current_user)):
    """Get all patients associated with the current user"""
    try:
        # Find all patients where user is either the owner or a caretaker
        patients = await db.patients.find({
            "$or": [
                {"user_id": current_user["username"]},
                {"caretakers": current_user["username"]},
                {"patient_id": current_user["username"]}
            ]
        }).to_list(None)
        
        if not patients:
            return {"patients": []}
        
        # Convert ObjectIds and format response
        formatted_patients = []
        for patient in patients:
            formatted_patient = {
                "patient_id": patient["patient_id"],
                "name": patient.get("name", "Unknown"),
                "age": patient.get("age"),
                "gender": patient.get("gender"),
                "alzheimer_stage": patient.get("alzheimer_stage", "unknown")
            }
            formatted_patients.append(formatted_patient)
        
        return {"patients": formatted_patients}
        
    except Exception as e:
        print(f"Error fetching patients: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch patients: {str(e)}"
        )

async def calculate_game_metrics(current_scores, prev_scores):
    """Calculate game-specific metrics"""
    game_metrics = {}
    
    # Process current scores
    for score in current_scores:
        game_name = score["game_name"]
        if game_name not in game_metrics:
            game_metrics[game_name] = {
                "scores": [],
                "levels": [],
                "moves": [],
                "matches": [],
                "times": []
            }
            
        game_metrics[game_name]["scores"].append(score["score"])
        if "level" in score:
            game_metrics[game_name]["levels"].append(score["level"])
        if "moves" in score:
            game_metrics[game_name]["moves"].append(score["moves"])
        if "matches" in score:
            game_metrics[game_name]["matches"].append(score["matches"])
        if "time" in score:
            game_metrics[game_name]["times"].append(score["time"])
    
    # Calculate metrics for each game
    result = []
    for game_name, metrics in game_metrics.items():
        game_data = {
            "name": game_name,
            "average_score": sum(metrics["scores"]) / len(metrics["scores"]) if metrics["scores"] else 0,
            "highest_score": max(metrics["scores"]) if metrics["scores"] else 0,
            "level": max(metrics["levels"]) if metrics["levels"] else 1,
            "total_games": len(metrics["scores"]),
            "improvement": 0  # Will be calculated if prev_scores exist
        }
        
        # Calculate improvement
        prev_game_scores = [s["score"] for s in prev_scores if s["game_name"] == game_name]
        if prev_game_scores:
            prev_avg = sum(prev_game_scores) / len(prev_game_scores)
            current_avg = game_data["average_score"]
            game_data["improvement"] = ((current_avg - prev_avg) / prev_avg * 100) if prev_avg > 0 else 0
        
        result.append(game_data)
    
    return result

async def get_high_scores(patient_id: str):
    """Get high scores for each game"""
    high_scores = {}
    
    async for score in db.scores.find(
        {"patient_id": patient_id, "is_high_score": True}
    ):
        game_name = score["game_name"]
        high_scores[game_name] = {
            "score": score["score"],
            "date": score["date"],
            "details": {k: v for k, v in score.items() if k not in ["_id", "patient_id", "game_name", "is_high_score"]}
        }
    
    return high_scores

async def get_streaks(patient_id: str):
    """Get streak information for a patient"""
    game_user = await db.game_users.find_one({"patient_id": patient_id})
    if not game_user:
        return {
            "current_streak": 0,
            "longest_streak": 0,
            "last_login": None
        }
    
    return {
        "current_streak": game_user.get("current_streak", 0),
        "longest_streak": game_user.get("longest_streak", 0),
        "last_login": game_user.get("last_login_date")
    }

images_collection = db["images"]
# Pydantic model for a single story response
class StoryItem(BaseModel):
    story: str
    image_url: str  # Cloudinary URL to display the image

# Pydantic model for the list of stories
class StoryResponse(BaseModel):
    stories: list[StoryItem]

@app.get("/api/storytelling/{patient_id}", response_model=StoryResponse)
async def generate_stories(patient_id: str, current_user: dict = Depends(get_current_user)):
    try:
        print(f"Attempting to fetch story for patient_id: {patient_id}")
        print(f"Current user: {current_user['username']}")
        
        # First check if the patient exists
        patient = await db.patients.find_one({"patient_id": patient_id})
        if not patient:
            print(f"Patient {patient_id} not found in database")
            raise HTTPException(status_code=404, detail="Patient not found")

        # Check access permissions - more inclusive check
        access_granted = False
        if (patient.get("user_id") == current_user["username"] or
            current_user["username"] in patient.get("caretakers", []) or
            patient.get("patient_id") == current_user["username"] or
            current_user.get("role") in ["admin", "doctor"] or
            patient.get("uploaded_by") == current_user["username"]):
            access_granted = True

        if not access_granted:
            print(f"Access denied for user {current_user['username']} to patient {patient_id}")
            print(f"Patient data: user_id={patient.get('user_id')}, caretakers={patient.get('caretakers', [])}")
            raise HTTPException(status_code=403, detail="Access denied for this patient")

        # Initialize Groq client
        groq_client = Groq(api_key=GROQ_API_KEY)

        # Fetch all image data for the patient_id from MongoDB
        print(f"Fetching images for patient {patient_id}")
        images_cursor = db.images.find({"patient_id": patient_id})
        image_data_list = await images_cursor.to_list(length=None)  # Get all images
        
        print(f"Found {len(image_data_list)} images for patient {patient_id}")
        
        if not image_data_list:
            raise HTTPException(status_code=404, detail="No images found for this patient ID")
        
        # Filter out images without URLs
        valid_images = [img for img in image_data_list if img.get("cloudinary_url")]
        if not valid_images:
            raise HTTPException(status_code=404, detail="No valid images found for this patient ID")

        # Select one random image
        selected_image = choice(valid_images)
        description = selected_image.get("description", "A cherished memory.")
        image_url = selected_image.get("cloudinary_url")
        
        print(f"Selected image: {selected_image.get('_id')} - {description}")

        # Generate story using Groq API
        try:
            # Enhance the prompt with more context if available
            context = []
            if selected_image.get("type") == "person":
                context.append(f"This is a photo of {selected_image.get('person_name', 'someone')}, "
                             f"who is a {selected_image.get('relation_to_patient', 'person')} to the patient.")
            
            context_str = " ".join(context)
            
            response = groq_client.chat.completions.create(
                model="llama3-70b-8192",
                messages=[
                    {
                        "role": "system", 
                        "content": "You are a creative storyteller specializing in memory care. Generate a heartwarming, "
                                 "personal story (250-500 words) that helps preserve and celebrate memories. Focus on "
                                 "emotional connection and positive experiences."
                    },
                    {
                        "role": "user", 
                        "content": f"Generate an uplifting story based on this memory: {description}. {context_str}"
                                 f"Make it personal and emotionally resonant, helping to preserve this special moment."
                    }
                ],
                max_tokens=500,
                temperature=0.7
            )
            story = response.choices[0].message.content.strip()
        except Exception as e:
            print(f"Error generating story for image {selected_image.get('_id')}: {str(e)}")
            story = "Could not generate story for this image."
        
        # Return single story
        stories = [{
            "story": story,
            "image_url": image_url,
            "description": description,
            "uploaded_at": selected_image.get("uploaded_at", datetime.utcnow())
        }]
        
        print("Successfully generated story")
        return {"stories": stories}
        
    except HTTPException as he:
        print(f"HTTP Exception in generate_stories: {str(he)}")
        raise he
    except Exception as e:
        print(f"Unexpected error in generate_stories: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error generating stories: {str(e)}")