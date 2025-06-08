import React, { useState, useEffect,useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaGamepad, FaUser, FaBell, FaFire, FaHome, FaTrophy, FaCalendarAlt, FaPills,FaRobot, FaChartLine, FaBrain, FaCog } from 'react-icons/fa';
import Calendar from 'react-calendar';
import { FaBook } from 'react-icons/fa';
import 'react-calendar/dist/Calendar.css';
import './PatientHome.css';
import Chatbot from '../Chatbot/Chatbot';
import Storytelling from '../storytelling';


const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://127.0.0.1:8000';

const PatientHome = () => {
  // Initialize prevLevelRef with value from localStorage
  const prevLevelRef = useRef(parseInt(localStorage.getItem('lastLevel')) || 1);
  
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showGamesDropdown, setShowGamesDropdown] = useState(false);
  const [gameUser, setGameUser] = useState({
    level: 1,
    exp: 0,
    badges: [],
    games_played: {}
  });
  const [streak, setStreak] = useState({
    current: 0,
    longest: 0,
    bonus: 0
  });
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [username, setUsername] = useState('');
  const [date, setDate] = useState(new Date());
  const [scheduleData, setScheduleData] = useState({
    appointments: [],
    medications: []
  });
  const [patientData, setPatientData] = useState(null);
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [newLevel, setNewLevel] = useState(null);
  const [expAnimation, setExpAnimation] = useState(0);
  const [completedAppointments, setCompletedAppointments] = useState({});
  const [takenMedications, setTakenMedications] = useState({});
  // Add this near the top of your component
  const MEDICATION_TIMES = {
    'Morning': { time: '09:00', icon: '🌞' },
    'Afternoon': { time: '13:00', icon: '☀️' },
    'Evening': { time: '17:00', icon: '🌆' },
    'Night': { time: '20:00', icon: '🌙' }
  };
  const fetchNotifications = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      // First fetch existing notifications
      const response = await fetch(`${API_BASE_URL}/api/notifications`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch notifications: ${response.status}`);
      }

      const existingNotifications = await response.json();
      
      // Check for upcoming appointments and medications
      const now = new Date();
      const tenMinutesFromNow = new Date(now.getTime() + 10 * 60000);
      
      // Generate notifications for upcoming appointments
      const upcomingAppointments = scheduleData.appointments.filter(appt => {
        if (completedAppointments[appt.id]) return false;
        const apptTime = new Date(`${appt.date}T${appt.time}`);
        return apptTime > now && apptTime <= tenMinutesFromNow;
      }).map(appt => ({
        _id: `appointment-${appt.id}-${appt.date}-${appt.time}`,
        type: 'appointment',
        message: `Upcoming appointment in ${Math.round((new Date(`${appt.date}T${appt.time}`) - now) / 60000)} minutes with Dr. ${appt.doctor_name || appt.doctor_id}`,
        created_at: new Date().toISOString(),
        read: false
      }));

      // Generate notifications for upcoming medications
      const upcomingMedications = scheduleData.medications.flatMap(med => {
        // Skip if medication object is invalid or missing required fields
        if (!med || !med.time || !Array.isArray(med.time)) return [];
        
        return med.time.filter(timeSlot => {
          const dateKey = now.toISOString().split('T')[0];
          const takenKey = `${dateKey}_${med.id}_${timeSlot}`;
          if (takenMedications[takenKey]) return false;

          const [hours, minutes] = MEDICATION_TIMES[timeSlot]?.time.split(':') || ['00', '00'];
          const medTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
          return medTime > now && medTime <= tenMinutesFromNow;
        }).map(timeSlot => ({
          _id: `medication-${med.id}-${timeSlot}-${now.toISOString().split('T')[0]}`,
          type: 'medication',
          message: `Time to take ${med.name || 'your medication'} (${timeSlot})`,
          created_at: new Date().toISOString(),
          read: false,
          medication: {
            id: med.id,
            name: med.name || 'Medication',
            time: timeSlot,
            description: med.description || ''
          }
        }));
      });

      // Combine all notifications and remove duplicates
      const allNotifications = [...existingNotifications, ...upcomingAppointments, ...upcomingMedications]
        .filter((notification, index, self) => 
          index === self.findIndex(n => n._id === notification._id)
        )
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      setNotifications(allNotifications);

      // Show browser notification if supported
      if (Notification.permission === "granted" && (upcomingAppointments.length > 0 || upcomingMedications.length > 0)) {
        [...upcomingAppointments, ...upcomingMedications].forEach(notification => {
          new Notification("Memory Lane Reminder", {
            body: notification.message,
            icon: "/favicon.ico"
          });
        });
      }

      return allNotifications;
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
      setError(error.message);
      return [];
    }
  };

  // Add useEffect for browser notification permission
  useEffect(() => {
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Update the notification check interval to run more frequently
  useEffect(() => {
    let isMounted = true;
    
    const fetchAndSetNotifications = async () => {
      const newNotifications = await fetchNotifications();
      if (isMounted) {
        setNotifications(newNotifications);
      }
    };

    // Check for notifications every minute
    const interval = setInterval(fetchAndSetNotifications, 60000);

    fetchAndSetNotifications(); // Initial fetch

    return () => {
      clearInterval(interval);
      isMounted = false;
    };
  }, [scheduleData, completedAppointments, takenMedications]);

  const markNotificationAsRead = async (notificationId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/notifications/${notificationId}/read`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        // Update local state to mark as read
        setNotifications(notifications.map(n => 
          n._id === notificationId ? {...n, read: true} : n
        ));
      }
    } catch (error) {
      console.error("Error marking notification as read:", error);
    }
  };

  const handleRemindLater = async (notificationId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/notifications/${notificationId}/remind-later`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        // Mark original as read and refresh notifications
        await markNotificationAsRead(notificationId);
        const newNotifications = await fetchNotifications();
        setNotifications(newNotifications);
        console.log("Appointment reminder scheduled for 15 minutes later");
      }
    } catch (error) {
      console.error("Error setting remind later:", error);
    }
  };

  useEffect(() => {
    let isMounted = true;
    
    const fetchAndSetNotifications = async () => {
      const newNotifications = await fetchNotifications();
      if (isMounted) {
        setNotifications(newNotifications);
      }
    };

    const interval = setInterval(fetchAndSetNotifications, 30000); // Check every 30 seconds

    fetchAndSetNotifications(); // Initial fetch

    return () => {
      clearInterval(interval);
      isMounted = false;
    };
  }, []);
  // Add this inside your PatientHome component
  useEffect(() => {
    const recordDailyLogin = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_BASE_URL}/api/daily-login`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to record daily login');
        }
        
        const data = await response.json();
        if (data.success) {
          setStreak(prev => ({
            ...prev,
            current: data.current_streak,
            longest: data.longest_streak,
            lastUpdated: new Date()
          }));
        }
      } catch (error) {
        setError(error.message);
        console.error("Error recording daily login:", error);
      }
    };

    // Call this when component mounts
    recordDailyLogin();
  }, []);

  useEffect(() => {
    
    const fetchPatientData = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/api/patient_stats`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('No patient data found');
          }
          throw new Error(`Failed to fetch patient data: ${response.status}`);
        }

        const data = await response.json();
        setPatientData(data.patient);
        setStats(data.stats);
        return data.patient;
      } catch (error) {
        console.error('Error:', error);
        setError(error.message);
        return null;
      } finally {
        setIsLoading(false);
      }
    };
    const fetchMedications = async (patientId) => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/medications?patient_id=${patientId}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
    
        if (!response.ok) {
          throw new Error(`Failed to fetch medications: ${response.status}`);
        }
    
        const data = await response.json();
        return Array.isArray(data) ? data : [];
      } catch (error) {
        console.error("Error fetching medications:", error);
        return [];
      }
    };
    

    // Fetch all required data
    const fetchAllData = async () => {
      const patientData = await fetchPatientData();
      if (!patientData) {
        console.error("No patient data available");
        return;
      }
      // Fetch game user data
try {
  const patientId = patientData?.patient_id || localStorage.getItem('patientId');
  console.log("Fetching game user for patient ID:", patientId); // Debug log
  
  if (patientId) {
    const response = await fetch(`${API_BASE_URL}/api/game_user/${patientId}`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });

    console.log("Game user response status:", response.status); // Debug log

    if (!response.ok) {
      throw new Error(`Failed to fetch game user: ${response.status}`);
    }

    const data = await response.json();
    console.log("Game user data received:", data); // Debug log
    setGameUser(data);
  }
} catch (error) {
  console.error("Game user error:", error);
  // Maintain the existing default state
  setGameUser(prev => ({
    ...prev,
    level: 1,
    exp: 0,
    badges: [],
    games_played: {}
  }));
}

// Fetch schedule data
try {
  const patientId = patientData?.patient_id || localStorage.getItem('patientId');
  if (patientId) {
    const [appointmentsRes, medicationsRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/appointments?patient_id=${patientId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      }),
      fetch(`${API_BASE_URL}/api/medications?patient_id=${patientId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      })
    ]);

    const appointments = appointmentsRes.ok ? await appointmentsRes.json() : [];
    const medications = medicationsRes.ok ? await medicationsRes.json() : [];
    
    // Initialize completed appointments state
    const completedAppts = {};
    appointments.forEach(appt => {
      if (appt.completed) {
        completedAppts[appt.id] = true;
      }
    });
    setCompletedAppointments(completedAppts);
    
    // Initialize taken medications state
    const takenMeds = {};
medications.forEach(med => {
  med.taken_times?.forEach(takenTime => {
    const dateKey = new Date(takenTime.date || takenTime.taken_at).toISOString().split('T')[0];
    takenMeds[`${dateKey}_${med.id}_${takenTime.time}`] = true;
  });
});
setTakenMedications(takenMeds);
    
    setScheduleData({
      appointments: Array.isArray(appointments) ? appointments : [],
      medications: Array.isArray(medications) ? medications : []
    });
  }
} catch (error) {
  console.error("Failed to fetch schedule data:", error);
  setScheduleData({
    appointments: [],
    medications: []
  });
}



      // Fetch user profile
      try {
        const response = await fetch(`${API_BASE_URL}/api/user`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        const data = await response.json();
        setUsername(data.username);
      } catch (error) {
        console.error("Failed to fetch user profile:", error);
      }

      // Fetch schedule data
      try {
        const patientId = patientData?.patient_id || localStorage.getItem('patientId');
        if (patientId) {
          const [appointmentsRes, medications] = await Promise.all([
            fetch(`${API_BASE_URL}/api/appointments?patient_id=${patientId}`, {
              headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
              }
            }),
            fetchMedications(patientId)
          ]);

          const appointments = await appointmentsRes.json();
          
          setScheduleData({
            appointments,
            medications
          });
        }
      } catch (error) {
        console.error("Failed to fetch schedule data:", error);
      }

      // Fetch notifications
      try {
        const response = await fetch(`${API_BASE_URL}/api/notifications`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        const data = await response.json();
        setNotifications(data);
      } catch (error) {
        console.error("Failed to fetch notifications:", error);
      }
    };

    fetchAllData();
  }, []);

  const handleAppointmentComplete = async (appointmentId) => {
    try {
      // Optimistically update the UI
      setCompletedAppointments(prev => ({
        ...prev,
        [appointmentId]: true
      }));
  
      const response = await fetch(`${API_BASE_URL}/api/appointments/${appointmentId}/status`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ completed: true })
      });
  
      if (!response.ok) {
        // Revert if the request fails
        setCompletedAppointments(prev => {
          const newState = {...prev};
          delete newState[appointmentId];
          return newState;
        });
        throw new Error('Failed to update appointment status');
      }
    } catch (error) {
      console.error("Error updating appointment status:", error);
      setError(error.message);
    }
  };
  
  const handleMedicationTaken = async (medicationId, time) => {
    try {
      // Create a unique key with date, medication ID, and time
      const dateKey = date.toISOString().split('T')[0];
      const takenKey = `${dateKey}_${medicationId}_${time}`;
      
      // Optimistically update the UI
      setTakenMedications(prev => ({
        ...prev,
        [takenKey]: true
      }));
  
      const response = await fetch(`${API_BASE_URL}/api/medications/${medicationId}/status`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          taken: true, 
          time,
          date: dateKey  // Send the date to the backend
        })
      });
  
      if (!response.ok) {
        // Revert if the request fails
        setTakenMedications(prev => {
          const newState = {...prev};
          delete newState[takenKey];
          return newState;
        });
        throw new Error('Failed to update medication status');
      }
    } catch (error) {
      console.error("Error updating medication status:", error);
      setError(error.message);
    }
  };

  const handleGameSelect = (game) => {
    setShowGamesDropdown(false);
    navigate(`/${game}`);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('patientId');
    localStorage.removeItem('lastLevel');
    navigate('/');
  };

  const expPercentage = gameUser && gameUser.level
  ? Math.min(100, ((gameUser.exp % (gameUser.level * 100)) / (gameUser.level * 100) * 100))
  : 0;

// Update the display text to show proper remaining EXP
<span className="exp-text">
  {gameUser.exp % (gameUser.level * 100)}/{gameUser.level * 100} EXP
</span>


  useEffect(() => {
    if (gameUser?.level) {
      const lastLevel = parseInt(localStorage.getItem('lastLevel')) || 1;
      
      if (gameUser.level > lastLevel) {
        // Only show level up if there's an actual increase from last saved level
        setNewLevel(gameUser.level);
        setShowLevelUp(true);
        localStorage.setItem('lastLevel', gameUser.level.toString());
      }
      
      // Always update the ref to current level
      prevLevelRef.current = gameUser.level;
    }
  }, [gameUser?.level]);
  
  // Filter schedule items for the selected date
  const getScheduleForDate = (date) => {
    // Create a date-only string in local time (YYYY-MM-DD)
    const dateStr = new Date(date.getTime() - (date.getTimezoneOffset() * 60000))
      .toISOString()
      .split('T')[0];
    
    // Safely handle appointments
    const dailyAppointments = Array.isArray(scheduleData.appointments) 
      ? scheduleData.appointments.filter(appt => {
          // Compare with the stored date string directly
          return appt.date === dateStr;
        })
      : [];
  
    // Safely handle medications
    const dailyMedications = Array.isArray(scheduleData.medications) 
      ? scheduleData.medications.filter(med => {
          if (!med.created_at || !med.expires_at) return false;
          
          try {
            // Create date objects without timezone conversion
            const startDate = new Date(med.created_at.split('T')[0]);
            const endDate = new Date(med.expires_at.split('T')[0]);
            const currentDate = new Date(dateStr);
            
            return currentDate >= startDate && currentDate <= endDate;
          } catch (e) {
            console.error("Error parsing medication dates:", e);
            return false;
          }
        })
      : [];
  
    return {
      appointments: dailyAppointments,
      medications: dailyMedications
    };
  };

  const tileContent = ({ date, view }) => {
    if (view === 'month') {
      const dateStr = date.toISOString().split('T')[0];
      const hasAppointments = scheduleData.appointments?.some(
        appt => appt.date === dateStr
      );
      const hasMedications = scheduleData.medications?.some(med => {
        const startDate = new Date(med.created_at);
        const endDate = new Date(med.expires_at);
        return date >= startDate && date <= endDate;
      });
  
      return (
        <div className="calendar-indicators">
          {hasAppointments && <div className="appointment-indicator" />}
          {hasMedications && <div className="medication-indicator" />}
        </div>
      );
    }
  };

  const dailySchedule = getScheduleForDate(date);
  
  
  
  // Update your exp bar animation
const animateExpBar = (expGain) => {
  const duration = 1000; // 1 second
  const startExp = gameUser?.exp || 0;
  const startTime = performance.now();
  
  const animate = (currentTime) => {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Calculate current EXP based on progress
    const currentExp = startExp + (expGain * progress);
    setExpAnimation(currentExp);
    
    if (progress < 1) {
      requestAnimationFrame(animate);
    }
  };
  
  requestAnimationFrame(animate);
};
  
  const fetchGameUserData = async () => {
    try {
      const patientId = patientData?.patient_id || localStorage.getItem('patientId');
      if (patientId) {
        const response = await fetch(`${API_BASE_URL}/api/game_user/${patientId}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });

        if (!response.ok) {
          throw new Error('Failed to fetch game user data');
        }

        const data = await response.json();
        console.log("Game user data fetched:", data); // Debug log
        
        setGameUser(data);
        setStreak({
          current: data.current_streak || 0,
          longest: data.longest_streak || 0,
          bonus: 0
        });
        
        return data;
      }
    } catch (error) {
      console.error("Failed to fetch game user data:", error);
      // Set default values if fetch fails
      setGameUser({
        level: 1,
        exp: 0,
        badges: [],
        games_played: {},
        current_streak: 0,
        longest_streak: 0
      });
    }
  };

  // Add level up modal component
  const LevelUpModal = ({ level, onClose }) => (
    <div className="level-up-modal">
      <div className="level-up-content">
        <div className="confetti">
          {[...Array(20)].map((_, i) => (
            <div key={i} className="confetti-piece" style={{
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 3}s`,
              backgroundColor: `hsl(${Math.random() * 360}, 70%, 50%)`
            }} />
          ))}
        </div>
        <h1>🎉</h1>
        <h2>Level Up!</h2>
        <p>You've reached Level {level}!</p>
        <button className="close-button" onClick={onClose}>Continue</button>
      </div>
    </div>
  );

  // Calculate progress to next level
  const calculateExpProgress = (exp, level) => {
    if (!exp || !level) return 0;
    const expForLevel = level * 100;
    const currentLevelExp = exp % expForLevel;
    return Math.min(100, (currentLevelExp / expForLevel) * 100);
  };

  useEffect(() => {
    if (patientData?.patient_id) {
      fetchGameUserData();
    }
  }, [patientData]);

  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading your data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <h2>Error Loading Data</h2>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Try Again</button>
      </div>
    );
  }
  return (
    <div className="patient-home-container">
      {/* Modern Header */}
      <header className="patient-header">
        <div className="header-left">
          <h1>Memory Lane</h1>
          <p>Welcome back, {patientData?.name || 'Patient'}!</p>
        </div>
        
        <div className="header-right">
          {/* Level Display in Header */}
          <div className="level-display-compact">
            <FaTrophy className="level-icon" />
            <span>Level {gameUser?.level || 1}</span>
          </div>
          
          {/* Streak Display */}
          <div className="streak-display-compact">
            <FaFire className="streak-icon" />
            <span>{streak.current} Days</span>
          </div>
          
          <div 
            className="notification-icon" 
            onClick={() => setShowNotifications(!showNotifications)}
          >
            <FaBell />
            {notifications.length > 0 && (
              <span className="notification-badge">{notifications.length}</span>
            )}
          </div>
          
          <div className="profile-container">
            <button 
              className="profile-btn"
              onClick={() => setShowProfileDropdown(!showProfileDropdown)}
            >
              <FaUser />
              <span className="username">{username}</span>
            </button>

            {showProfileDropdown && (
              <div className="profile-dropdown">
                <div className="profile-info">
                  <h3 className="profile-name">{patientData?.name}</h3>
                  <p className="profile-stage">Stage: {patientData?.alzheimer_stage || 'N/A'}</p>
                </div>
                <div className="profile-menu">
                  <button 
                    className="menu-item logout"
                    onClick={handleLogout}
                  >
                    <FaUser /> Log Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Navigation */}
<nav className="patient-nav">
  <button 
    className={`nav-button ${activeTab === 'dashboard' ? 'active' : ''}`}
    onClick={() => setActiveTab('dashboard')}
  >
    <FaHome /> Dashboard
  </button>
  
  <button 
    className={`nav-button ${activeTab === 'games' ? 'active' : ''}`}
    onClick={() => setActiveTab('games')}
  >
    <FaGamepad /> Games
  </button>
  
  <button 
    className={`nav-button ${activeTab === 'schedule' ? 'active' : ''}`}
    onClick={() => setActiveTab('schedule')}
  >
    <FaCalendarAlt /> Schedule
  </button>

  <button 
    className={`nav-button ${activeTab === 'stories' ? 'active' : ''}`}
    onClick={() => setActiveTab('stories')}
  >
    <FaBook /> Stories
  </button>
</nav>



      {/* Main Content Area */}
      <main className="patient-main">
        {activeTab === 'dashboard' && (
          <div className="dashboard-container">
            {gameUser && (
              <div className="streak-section">
                <h3>Daily Streak</h3>
                <div className="streak-display">
                  <div className="streak-count">
                    <FaFire className="streak-icon" />
                    <span>{streak.current} days</span>
                  </div>
                  <div className="streak-info">
                    <p>Longest streak: {streak.longest} days</p>
                    {streak.bonus > 0 && (
                      <p className="streak-bonus">+{streak.bonus}% EXP bonus today!</p>
                    )}
                  </div>
                </div>
              </div>
            )}
            {gameUser ? (
                <div className="progress-section">
                    <h3>Your Progress</h3>
                    
                    <div className="level-display">
                      <div className="level-badge">
                        <FaTrophy className="level-icon" />
                        <span className="level-text">Level {gameUser?.level || 1}</span>
                      </div>
                      
                      <div className="exp-bar">
                        <div 
                          className={`exp-progress ${expAnimation > 0 ? 'animating' : ''}`}
                          style={{ width: `${calculateExpProgress(gameUser?.exp || 0, gameUser?.level || 1)}%` }}
                        ></div>
                        <span className="exp-text">
                          {gameUser?.exp ? `${gameUser.exp % (gameUser.level * 100)}/${gameUser.level * 100}` : '0/100'}
                        </span>
                      </div>
                    </div>
                
                {showLevelUp && (
                  <LevelUpModal 
                    level={newLevel} 
                    onClose={() => setShowLevelUp(false)} 
                  />
                )}
                
                {gameUser.badges && gameUser.badges.length > 0 ? (
                  <div className="badges-section">
                    <h4>Your Badges</h4>
                    <div className="badges-grid">
                      {gameUser.badges.map((badge, index) => (
                        <div key={index} className="badge-item">
                          <FaTrophy />
                          <span>{badge}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p>Play games to earn your first badge!</p>
                )}
              </div>
            ) : (
              <div className="progress-section loading">
                <p>Loading your progress data...</p>
              </div>
            )}
            
            <div className="quick-stats">
              <div className="stat-card">
                <FaGamepad />
                <h4>Games Played</h4>
                <p>{gameUser?.games_played ? Object.values(gameUser.games_played).reduce((a, b) => a + (b || 0), 0) : 0}</p>
              </div>

              <div className="stat-card">
                <FaUser />
                <h4>Age</h4>
                <p>{patientData?.age || 'N/A'}</p>
              </div>

              <div className="stat-card">
                <FaPills />
                <h4>Medications</h4>
                <p>{patientData?.medications?.length || 0}</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'games' && (
          <div className="games-container">
            <h2>Memory Training Games</h2>
            <p className="games-intro">Choose a game to start training your memory</p>
            
            <div className="games-grid-showcase">
              <div className="game-card" onClick={() => navigate('/cardgame')}>
                <div className="game-icon">
                  <FaBrain />
                </div>
                <h3>Card Matching</h3>
                <div className="game-details">
                  <span className="difficulty">Beginner Friendly</span>
                  <span className="duration">5-10 mins</span>
                </div>
                <button className="play-button">
                  Play Now <FaGamepad />
                </button>
              </div>
              
              <div className="game-card" onClick={() => navigate('/memotap')}>
                <div className="game-icon">
                  <FaGamepad />
                </div>
                <h3>Memo Tap</h3>
                <div className="game-details">
                  <span className="difficulty">All Levels</span>
                  <span className="duration">3-8 mins</span>
                </div>
                <button className="play-button">
                  Play Now <FaGamepad />
                </button>
              </div>
            </div>

            {gameUser && gameUser.games_played && (
              <div className="games-stats">
                <h3>Your Gaming Stats</h3>
                <div className="stats-grid">
                  <div className="stat-card">
                    <FaGamepad className="stat-icon" />
                    <div className="stat-info">
                      <h4>Total Games</h4>
                      <p>{Object.values(gameUser.games_played).reduce((a, b) => a + (b || 0), 0)}</p>
                    </div>
                  </div>
                  <div className="stat-card">
                    <FaTrophy className="stat-icon" />
                    <div className="stat-info">
                      <h4>Current Level</h4>
                      <p>{gameUser.level}</p>
                    </div>
                  </div>
                  <div className="stat-card">
                    <FaFire className="stat-icon" />
                    <div className="stat-info">
                      <h4>Current Streak</h4>
                      <p>{streak.current} days</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {activeTab === 'stories' && (
          <Storytelling patientId={patientData?.patient_id || localStorage.getItem('patientId')} />
        )}
        {activeTab === 'schedule' && (
          <div className="schedule-container">
            <h2>Your Schedule</h2>
            
            <div className="calendar-section">
              <Calendar
                onChange={setDate}
                value={date}
                className="react-calendar-custom"
              />
              
              <div className="schedule-items">
                <h3>Schedule for {date.toDateString()}</h3>
                
                {dailySchedule.appointments.length > 0 && (
                  <div className="appointments-list">
                    <h4><FaCalendarAlt /> Appointments</h4>
                    <ul>
                      {dailySchedule.appointments.map((appt) => {
                          const apptDate = new Date(appt.date);
                          const displayDate = apptDate.toLocaleDateString('en-US', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric'
                          });
                          return(
                        <li key={appt.id} className={completedAppointments[appt.id] ? 'completed' : ''}>
                          <div className="appointment-info">
                            <strong>{appt.time}</strong> - with Dr. {appt.doctor_id || 'No description'}
                            {appt.doctor_name && <span> ({appt.doctor_name})</span>}
                            ,  <span className="appointment-date">{displayDate}</span>
                          </div>
                          {!completedAppointments[appt.id] && (
                            <button 
                              className="complete-btn"
                              onClick={() => handleAppointmentComplete(appt.id)}
                            >
                              Done
                            </button>
                          )}
                          {completedAppointments[appt.id] && (
                            <span className="completed-check">✓ Done</span>
                          )}
                        </li>
                          );
                        })}
                    </ul>
                  </div>
                )}
                
                {dailySchedule.medications.length > 0 && (
                  <div className="medications-list">
                    <h4><FaPills /> Today's Medications</h4>
                    <ul>
                      {dailySchedule.medications.map((med) => (
                        <li key={med.id}>
                          <div className="medication-info">
                            <div className="med-header">
                              <strong>{med.name}</strong>
                              {med.expires_at && new Date(med.expires_at) < new Date() && (
                                <span className="expired-badge">Expired</span>
                              )}
                            </div>
                            
                            <div className="medication-times">
                            {med.time.map((time) => {
                              const timeSlot = MEDICATION_TIMES[time] || { time, icon: '⏰' };
                              const dateKey = date.toISOString().split('T')[0];
                              const takenKey = `${dateKey}_${med.id}_${time}`;
                              const isTaken = takenMedications[takenKey];
                              
                              return (
                                <div 
                                  key={`${med.id}_${time}`} 
                                  className={`time-slot ${isTaken ? 'taken' : ''}`}
                                >
                                  <span className="time-icon">{timeSlot.icon}</span>
                                  <span className="time-text">{time} ({timeSlot.time})</span>
                                  
                                  {!isTaken ? (
                                    <button
                                      className="take-btn"
                                      onClick={() => handleMedicationTaken(med.id, time)}
                                      aria-label={`Mark ${med.name} as taken at ${time}`}
                                    >
                                      Taken
                                    </button>
                                  ) : (
                                    <span className="taken-check" aria-label="Medication taken">✓</span>
                                  )}
                                </div>
                              );
                            })}
                            </div>
                            
                            {med.notes && (
                              <div className="med-notes">
                                <span className="notes-label">Notes:</span> {med.notes}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                
                {dailySchedule.appointments.length === 0 && dailySchedule.medications.length === 0 && (
                  <p>No scheduled items for this day</p>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Notifications Panel */}
      {showNotifications && (
        <div className="notifications-panel">
          <div className="notifications-header">
            <h3>Notifications</h3>
            <button onClick={() => setShowNotifications(false)}>&times;</button>
          </div>
{notifications.length > 0 ? (
  <ul className="notifications-list">
    {notifications.map((notification, index) => (
      <li key={index} className={notification.read ? 'read' : 'unread'}>
        <div className="notification-content">
          <p>{notification.message}</p>
          <small>{new Date(notification.created_at).toLocaleString()}</small>
        </div>
        {notification.type === 'appointment' && !notification.read && (
          <div className="notification-actions">
            <button 
              className="remind-later-btn"
              onClick={() => handleRemindLater(notification._id)}
            >
              Remind Me Later
            </button>
            <button 
              className="mark-read-btn"
              onClick={() => markNotificationAsRead(notification._id)}
            >
              Mark as Read
            </button>
          </div>
        )}
        {notification.type === 'medication' && !notification.read && (
          <button 
            className="mark-read-btn"
            onClick={() => markNotificationAsRead(notification._id)}
          >
            Mark as Read
          </button>
        )}
      </li>
    ))}
  </ul>
) : (
  <p>No new notifications</p>
)}
        </div>
      )}
      <Chatbot />
    </div>
  );
};

export default PatientHome;