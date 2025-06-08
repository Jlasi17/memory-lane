# Memory Lane - Cognitive Health Management Platform

Memory Lane is a comprehensive web application designed to help manage and monitor cognitive health, with a special focus on Alzheimer's and dementia care. The platform provides interactive cognitive games, patient monitoring, and healthcare provider integration.

## Features

- **User Roles**

  - Patient Portal
  - Family/Caregiver Portal
  - Doctor Portal

- **Interactive Cognitive Games**

  - MemoTap - Memory sequence game
  - Card Matching Game - Pattern recognition
  - Adaptive difficulty based on cognitive stage

- **Health Monitoring**

  - MRI scan upload and analysis
  - Patient progress tracking
  - Cognitive assessment tools
  - Treatment stage tracking

- **Patient Management**

  - Appointment scheduling
  - Medication reminders
  - Progress reports
  - Treatment plan management

- **AI Integration**
  - Chatbot support
  - Emotion recognition
  - Personalized assistance

## Technology Stack

### Frontend

- React.js
- React Router DOM
- Axios for API calls
- Framer Motion for animations
- React Calendar
- Font Awesome icons
- JWT for authentication

### Backend

- FastAPI
- MongoDB with Motor
- Python 3.8+
- JWT authentication
- Cloudinary for image storage
- Machine Learning integration
- Groq for AI processing

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- Python 3.8 or higher
- MongoDB
- npm or yarn

### Installation

1. Clone the repository:

```bash
git clone https://github.com/Jlasi17/memory-lane.git
cd memorey-lane/memoweb
```

2. Install frontend dependencies:

```bash
npm install
```

3. Install backend dependencies:

```bash
cd server
pip install -r requirements.txt
```

4. Set up environment variables:
   Create `.env` files in both frontend and backend directories with the necessary configurations.

### Frontend Environment Variables

```
REACT_APP_API_BASE_URL=http://127.0.0.1:8000
```

### Backend Environment Variables

```
MONGODB_URL=your_mongodb_url
SECRET_KEY=your_jwt_secret_key
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret
GROQ_API_KEY=your_groq_api_key
EMAIL_ADDRESS=your_email
EMAIL_PASSWORD=your_email_password
```

### Running the Application

1. Start the backend server:

```bash
cd server
uvicorn main:app --reload
```

2. Start the frontend development server:

```bash
npm start
```

The application will be available at `http://localhost:3000`
