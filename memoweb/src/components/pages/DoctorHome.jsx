import { useState, useEffect } from 'react';
import React from 'react';
import {
  PatientRegistrationForm,
  MRIScanUpload,
  ScheduleAppointment,
  AddMedication,
  PatientStatsDoc,
  Notifications
} from '../index';
import './docstyles.css';
import { useNavigate } from 'react-router-dom';
import ReportHistory from '../ReportHistory';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://127.0.0.1:8000';

const DoctorHome = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [patientData, setPatientData] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [registrationType, setRegistrationType] = useState('new');
  const [existingPatientId, setExistingPatientId] = useState('');
  const [showMRIModal, setShowMRIModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showMedicationModal, setShowMedicationModal] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [username, setUsername] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
  const [appointments, setAppointments] = useState([]);
  const [medications, setMedications] = useState([]);
  const [patients, setPatients] = useState([]);
  const [reportData, setReportData] = useState(null);
  const [latestReport, setLatestReport] = useState(null);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [message, setMessage] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState({
    rating: 0,
    comments: "",
    submitted: false,
  });

  const handleFeedbackSubmit = async (e) => {
    e.preventDefault();
    try {
      // Get current treatment stage
      const currentStage = patientData?.alzheimer_stage || "0";

      const response = await fetch(`${API_BASE_URL}/api/feedback`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          patient_id: selectedPatientId,
          rating: feedback.rating,
          comments: feedback.comments,
          treatment_stage: currentStage
        }),
      });

      if (response.ok) {
        setFeedback((prev) => ({ ...prev, submitted: true }));

        // Evaluate feedback and adjust treatment if needed
        await adjustTreatmentPlan(feedback.rating < 3);

        setTimeout(() => {
          setShowFeedback(false);
          setFeedback({ rating: 0, comments: "", submitted: false });
        }, 3000);
      }
    } catch (error) {
      console.error("Error submitting feedback:", error);
      setMessage("Failed to submit feedback. Please try again.");
    }
  };

  const adjustTreatmentPlan = async (isNegativeFeedback) => {
    try {
      const currentStage = patientData?.alzheimer_stage || "0";
      let newStage = currentStage;

      // Get latest game performance data
      const gameUser = await fetch(`${API_BASE_URL}/api/game_user/${selectedPatientId}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
      }).then(res => res.json());

      // Define stage progression
      const stages = ['0', '1', '2', '3', '4']; // 0: non_demented to 4: severe
      const currentIndex = stages.indexOf(currentStage);

      if (isNegativeFeedback) {
        // If feedback is negative, make games easier
        if (currentIndex < stages.length - 1) {
          newStage = stages[currentIndex + 1];
        }
      } else {
        // For positive feedback, check if player performance justifies improvement
        const levelThresholds = {
          '4': 5,  // Severe: Level 5 to progress
          '3': 10, // Moderate: Level 10 to progress
          '2': 15, // Mild: Level 15 to progress
          '1': 20, // Very Mild: Level 20 to progress
          '0': 25  // Non-demented: Level 25 to maintain
        };

        if (gameUser.level >= levelThresholds[currentStage] && currentIndex > 0) {
          // Player has reached level threshold, can progress to better treatment
          newStage = stages[currentIndex - 1];
        }
      }

      // Only update if stage has changed
      if (newStage !== currentStage) {
        const response = await fetch(`${API_BASE_URL}/api/update_patient_stage`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            patient_id: selectedPatientId,
            new_stage: newStage
          })
        });

        if (response.ok) {
          const stageName = {
            '0': 'Non-demented',
            '1': 'Very Mild',
            '2': 'Mild',
            '3': 'Moderate',
            '4': 'Severe'
          }[newStage];

          setMessage(
            isNegativeFeedback
              ? `Treatment adjusted to ${stageName} based on feedback. Games will be easier.`
              : `Treatment improved to ${stageName} based on good performance and feedback!`
          );

          // Refresh patient data
          await fetchPatientData();
        }
      }
    } catch (error) {
      console.error('Error adjusting treatment plan:', error);
      setMessage('Failed to adjust treatment plan. Please try again.');
    }
  };

  const getStageName = (stage) => {
    switch (stage) {
      case '0': return 'No Dementia (Master)';
      case '1': return 'Very Mild Dementia (Expert)';
      case '2': return 'Mild Dementia (Hard)';
      case '3': return 'Moderate Dementia (Medium)';
      case '4': return 'Severe Dementia (Easy)';
      default: return 'Unknown';
    }
  };


  useEffect(() => {
    if (activeTab === 'report') {
      fetchLatestReport();
    }
  }, [activeTab]);

  const navigate = useNavigate();
  // Fetch all necessary data on component mount
  useEffect(() => {
    const initializeData = async () => {
      try {
        await Promise.all([
          fetchPatientData(),
          fetchUsername(),
          fetchAppointments(),
          fetchMedications(),
          fetchPatients()
        ]);
        // Fetch notifications after appointments are loaded
        await fetchNotifications();
      } catch (error) {
        console.error('Initialization error:', error);
      }
    };
    initializeData();

    // Set up interval to check for upcoming appointments every minute
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, []);

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
          setActiveTab('register');
          throw new Error('No patient data found');
        }
        throw new Error(`Failed to fetch patient data.please reload the page..: ${response.status}`);
      }

      const data = await response.json();
      setPatientData(data.patient);
      setStats(data.stats);
      setActiveTab('dashboard');
    } catch (error) {
      console.error('Error:', error);
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPatients = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/user_patients`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch patients');
      }

      const data = await response.json();
      setPatients(data.patients || []);
    } catch (err) {
      console.error('Error fetching patients:', err);
    }
  };

  const fetchNotifications = async () => {
    try {
      // First fetch existing notifications
      const response = await fetch(`${API_BASE_URL}/api/notifications`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await response.json();

      // Check for upcoming appointments
      const now = new Date();
      const tenMinutesFromNow = new Date(now.getTime() + 10 * 60 * 1000);

      // Find appointments that are happening in the next 10 minutes
      const upcomingAppointments = appointments.filter(appointment => {
        const appointmentTime = new Date(`${appointment.date}T${appointment.time}`);
        const timeDiff = appointmentTime - now;
        // Check if appointment is within next 10 minutes and hasn't started yet
        return timeDiff > 0 && timeDiff <= 600000; // 600000ms = 10 minutes
      });

      // Create notifications for upcoming appointments with more details
      const appointmentNotifications = upcomingAppointments.map(appointment => {
        const appointmentTime = new Date(`${appointment.date}T${appointment.time}`);
        const minutesUntil = Math.round((appointmentTime - now) / 60000);

        return {
          id: `appointment-${appointment.id}`,
          type: 'appointment',
          title: '🕐 Upcoming Appointment',
          message: `Patient: ${appointment.patient_name}\nTime: ${appointment.time}\nDate: ${appointment.date}\nStarting in: ${minutesUntil} minutes\n\nPlease prepare for the consultation.`,
          timestamp: new Date().toISOString(),
          priority: 'high',
          read: false,
          actions: ['View Details', 'Reschedule']
        };
      });

      // Check for medication alerts
      const medicationAlerts = medications.filter(med => {
        const expiryDate = new Date(med.expires_at);
        const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
        return daysUntilExpiry <= 7;
      }).map(med => ({
        id: `medication-${med.id}`,
        type: 'medication',
        title: '💊 Medication Alert',
        message: `Medication: ${med.name}\nPatient: ${med.patient_name}\nExpires: ${new Date(med.expires_at).toLocaleDateString()}\n\nPlease review and renew if needed.`,
        timestamp: new Date().toISOString(),
        priority: 'medium',
        read: false,
        actions: ['Review', 'Renew']
      }));

      // Combine all notifications and sort by priority and timestamp
      const allNotifications = [...appointmentNotifications, ...medicationAlerts, ...data]
        .sort((a, b) => {
          // First sort by read status (unread first)
          if (!a.read && b.read) return -1;
          if (a.read && !b.read) return 1;

          // Then sort by priority
          const priorityOrder = { high: 0, medium: 1, low: 2 };
          const priorityDiff = (priorityOrder[a.priority] || 999) - (priorityOrder[b.priority] || 999);
          if (priorityDiff !== 0) return priorityDiff;

          // Finally sort by timestamp (newest first)
          return new Date(b.timestamp) - new Date(a.timestamp);
        });

      setNotifications(allNotifications);

      // Show browser notification if supported and enabled
      if (Notification.permission === "granted") {
        appointmentNotifications.forEach(notification => {
          new Notification(notification.title, {
            body: notification.message,
            icon: "/favicon.ico",
            tag: notification.id,
            requireInteraction: true // Keep notification until user interacts with it
          });
        });
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  // Set up polling interval for notifications
  useEffect(() => {
    // Initial fetch
    fetchNotifications();

    // Check every minute for new notifications
    const interval = setInterval(fetchNotifications, 60000);

    // Cleanup interval on component unmount
    return () => clearInterval(interval);
  }, [appointments, medications]); // Re-create interval when appointments or medications change

  const fetchLatestReport = async (patientId = null) => {
    setIsLoading(true);
    try {
      const pid = patientId || (patientData?.patient_id || selectedPatientId);
      if (!pid) {
        throw new Error('No patient selected');
      }

      const response = await fetch(`${API_BASE_URL}/api/generate_report?patient_id=${pid}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to generate report');
      }

      const reportData = await response.json();

      // Ensure all required fields exist with defaults
      const completeReport = {
        ...reportData,
        engagement: reportData.engagement || {
          sessions: 0,
          trend: '→',
          change: 0,
          percent_change: 0
        },
        improvement: reportData.improvement || {
          percentage: 0,
          games_improved: 0,
          games_declined: 0,
          games_with_data: 0
        },
        efficiency: reportData.efficiency || {
          ratio: 0,
          trend: 'N/A'
        },
        attention: reportData.attention || {
          average_time: 0,
          completion_rate: 0
        },
        games: reportData.games || []
      };

      setLatestReport(completeReport);
      setError(null);
    } catch (error) {
      console.error('Error fetching report:', error);
      setError(error.message);
      setLatestReport(null);
    } finally {
      setIsLoading(false);
    }
  };


  const fetchUsername = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/user`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('User info not available');
      }

      const data = await response.json();
      setUsername(data.username || data.email || 'User');
    } catch (error) {
      console.error('Error fetching username:', error);
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          setUsername(payload.email || payload.sub || 'User');
        } catch (e) {
          setUsername('User');
        }
      } else {
        setUsername('User');
      }
    }
  };

  const fetchAppointments = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/appointments`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await response.json();
      const sortedAppointments = data.sort((a, b) => {
        const dateA = new Date(`${a.date}T${a.time}`);
        const dateB = new Date(`${b.date}T${b.time}`);
        return dateA - dateB;
      });
      setAppointments(sortedAppointments);
    } catch (error) {
      console.error('Error fetching appointments:', error);
    }
  };

  const fetchMedications = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/medications`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await response.json();
      setMedications(data);
    } catch (error) {
      console.error('Error fetching medications:', error);
    }
  };

  const handlePatientRegistration = async (formData) => {
    setIsLoading(true);
    setError(null);

    try {
      if (registrationType === 'existing') {
        if (!existingPatientId.trim()) {
          throw new Error('Patient ID is required');
        }

        const response = await fetch(`${API_BASE_URL}/api/register_patient`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify({
            patient_id: existingPatientId,
            name: "Linked Patient",
            age: 65,
            gender: "other",
            email: `replay.test@gmail.com`,
            phone: "0000000000",
            medical_history: "",
            user_id: "",
            passcode: "",
            caretakers: [],
            stage: "non_demented"
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          let errorMessage = 'Registration failed';

          if (typeof errorData.detail === 'string') {
            errorMessage = errorData.detail;
          } else if (Array.isArray(errorData.detail)) {
            errorMessage = errorData.detail.map(d => d.msg).join(', ');
          } else if (typeof errorData.detail === 'object') {
            errorMessage = JSON.stringify(errorData.detail);
          }

          throw new Error(errorMessage);
        }
        await fetchPatientData();
        setActiveTab('dashboard');
        return;
      }

      const errors = {};
      if (!formData.name?.trim()) errors.name = 'Name is required';
      if (!formData.age || formData.age < 1 || formData.age > 119) errors.age = 'Age must be 1-119';
      if (!['male', 'female', 'other'].includes(formData.gender?.toLowerCase())) {
        errors.gender = 'Gender must be male/female/other';
      }
      if (!/^[^@]+@[^@]+\.[^@]+$/.test(formData.contact_info.email)) {
        errors.email = 'Invalid email format';
      }
      if (!/^\d{10,15}$/.test(formData.contact_info.phone)) {
        errors.phone = 'Phone must be 10-15 digits';
      }

      if (Object.keys(errors).length) {
        throw new Error(Object.values(errors).join(', '));
      }

      const response = await fetch(`${API_BASE_URL}/api/register_patient`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          name: formData.name.trim(),
          age: Number(formData.age),
          gender: formData.gender.toLowerCase(),
          medical_history: formData.medical_history?.trim(),
          email: formData.contact_info.email.trim(),
          phone: formData.contact_info.phone.trim()
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Registration failed');
      }

      await fetchPatientData();
      setActiveTab('dashboard');

    } catch (error) {
      console.error('Registration error:', error);
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddAppointment = async (appointmentData) => {
    setIsLoading(true);
    setError(null);

    try {
      // Verify we have a token
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      // Verify API base URL
      if (!API_BASE_URL) {
        throw new Error('API base URL not configured');
      }

      const response = await fetch(`${API_BASE_URL}/api/appointments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(appointmentData)
      });

      // Handle HTTP errors
      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        throw new Error(errorData.detail || 'Failed to add appointment');
      }

      const data = await response.json();
      await fetchAppointments();
      setShowScheduleModal(false);
      return data;
    } catch (error) {
      console.error('Error adding appointment:', error);
      setError(error.message);
      throw error; // Re-throw to handle in the calling component
    } finally {
      setIsLoading(false);
    }
  };


  const handleCompleteAppointment = async (appointmentId) => {
    try {
      if (!appointmentId) {
        throw new Error("No appointment ID provided");
      }

      const response = await fetch(`${API_BASE_URL}/api/appointments/${appointmentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to complete appointment');
      }

      await fetchAppointments();
    } catch (error) {
      console.error('Error completing appointment:', error);
      setError(error.message);
    }
  };


  const handleAddMedication = async (medicationData) => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/medications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(medicationData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to add medication');
      }

      await fetchMedications();
      setShowMedicationModal(false);
    } catch (error) {
      console.error('Error adding medication:', error);
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteMedication = async (medicationId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/medications/${medicationId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to delete medication');
      }

      await fetchMedications();
    } catch (error) {
      console.error('Error deleting medication:', error);
      setError(error.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/');
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showProfileDropdown && !event.target.closest('.profile-container')) {
        setShowProfileDropdown(false);
      }
      if (showNotifications && !event.target.closest('.notifications-container')) {
        setShowNotifications(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showProfileDropdown, showNotifications]);

  const handleMarkAllRead = async () => {
    try {
      // First get all unread notification IDs
      const unreadNotifications = notifications.filter(n => !n.read);

      if (unreadNotifications.length === 0) return;

      // Group notifications by type
      const appointmentNotifications = unreadNotifications.filter(n => n.id.startsWith('appointment-'));
      const medicationNotifications = unreadNotifications.filter(n => n.id.startsWith('medication-'));
      const mongoIdNotifications = unreadNotifications.filter(n =>
        !n.id.startsWith('appointment-') && !n.id.startsWith('medication-')
      );

      // Mark appointment notifications as read
      for (const notification of appointmentNotifications) {
        try {
          const appointmentId = notification.id.replace('appointment-', '');
          const response = await fetch(`${API_BASE_URL}/api/notifications/${notification.id}/read`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('token')}`,
              'Content-Type': 'application/json'
            }
          });

          if (!response.ok) {
            console.error(`Failed to mark appointment notification ${notification.id} as read`);
          }
        } catch (error) {
          console.error(`Error marking appointment notification ${notification.id} as read:`, error);
        }
      }

      // Mark medication notifications as read using bulk update
      if (medicationNotifications.length > 0) {
        const response = await fetch(`${API_BASE_URL}/api/notifications`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            type: 'mark_read',
            notifications: medicationNotifications.map(n => ({
              id: n.id.split('-')[1], // Extract the medication ID
              type: 'medication',
              read: true
            }))
          })
        });

        if (!response.ok) {
          console.error('Failed to mark medication notifications as read');
        }
      }

      // Mark regular MongoDB notifications as read in bulk
      if (mongoIdNotifications.length > 0) {
        const response = await fetch(`${API_BASE_URL}/api/notifications`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            type: 'mark_read',
            notifications: mongoIdNotifications.map(n => ({
              id: n.id,
              type: n.type || 'general',
              read: true
            }))
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(typeof errorData.detail === 'string'
            ? errorData.detail
            : 'Failed to mark notifications as read');
        }
      }

      // Update local state to mark all notifications as read
      setNotifications(prevNotifications =>
        prevNotifications.map(notification => ({
          ...notification,
          read: true
        }))
      );

    } catch (error) {
      console.error('Error marking notifications as read:', error);
      setError(typeof error.message === 'string' ? error.message : 'Failed to mark notifications as read. Please try again.');
      // Clear error after 3 seconds
      setTimeout(() => setError(null), 3000);
    }
  };

  const formatMetric = (value) => {
    if (value === undefined || value === null) return '0.00';
    return Number(value).toFixed(2);
  };

  const renderReport = (report) => {
    if (!report) return null;

    const metrics = [
      {
        title: 'Engagement',
        value: report.engagement?.sessions || 0,
        change: report.engagement?.change || 0,
        trend: report.engagement?.trend || '→'
      },
      {
        title: 'Improvement',
        value: report.improvement?.percentage || 0,
        change: report.improvement?.games_improved || 0,
        suffix: '%'
      },
      {
        title: 'Efficiency',
        value: report.efficiency?.ratio || 0,
        trend: report.efficiency?.trend || '→',
        interpretation: report.efficiency?.interpretation || 'No data available'
      },
      {
        title: 'Attention',
        value: report.attention?.completion_rate || 0,
        time: report.attention?.average_time || 0,
        interpretation: report.attention?.interpretation || 'No data available'
      }
    ];

    return (
      <div className="report-content">
        {report.games && report.games.length > 0 ? (
          <>
            <div className="metrics-grid">
              {metrics.map((metric, index) => (
                <div key={index} className="metric-card">
                  <h3>{metric.title}</h3>
                  <div className="metric-value">
                    {formatMetric(metric.value)}
                    {metric.suffix}
                    {metric.trend && <span className="trend">{metric.trend}</span>}
                  </div>
                  {metric.change !== undefined && (
                    <div className={`change ${metric.change > 0 ? 'positive' : metric.change < 0 ? 'negative' : ''}`}>
                      {metric.change > 0 ? '+' : ''}{metric.change}
                      {metric.title === 'Improvement' ? '% improvement' : ' sessions'}
                    </div>
                  )}
                  {metric.interpretation && (
                    <div className="interpretation">{metric.interpretation}</div>
                  )}
                  {metric.time !== undefined && (
                    <div className="sub-metric">
                      Avg. Time: {formatMetric(metric.time)}s
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="games-section">
              <h3>Game Performance</h3>
              {report.games.map((game, index) => (
                <div key={index} className="game-card">
                  <h4>{game.name}</h4>
                  <div className="game-stats">
                    <div>
                      <span>Sessions:</span> {game.sessions || 0}
                    </div>
                    <div>
                      <span>High Score:</span> {game.high_score || 0}
                    </div>
                    <div>
                      <span>Average:</span> {formatMetric(game.average_score)}
                    </div>
                    <div>
                      <span>Total Rounds:</span> {game.total_rounds || 0}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="report-error-message">
            <i className="fas fa-info-circle"></i>
            <div className="error-content">
              <p>No Recent Activity</p>
              <p>There hasn't been any game activity in the current period.</p>
              <p>Patient needs to play memory games to generate performance data.</p>

              <div className="error-suggestions">
                <p>Suggestions:</p>
                <ul>
                  <li>
                    <i className="fas fa-gamepad"></i>
                    Encourage the patient to try out different memory games
                  </li>
                  <li>
                    <i className="fas fa-calendar-check"></i>
                    Set up regular gaming sessions
                  </li>
                  <li>
                    <i className="fas fa-chart-line"></i>
                    Check back after some games have been played
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderFeedbackForm = () => {
    if (feedback.submitted) {
      return (
        <div className="feedback-form">
          <div className="feedback-header">
            <h3>Thank you for your feedback!</h3>
            <button className="feedback-close-btn" onClick={() => setShowFeedback(false)}>×</button>
          </div>
        </div>
      );
    }

    return (
      <form className="feedback-form" onSubmit={handleFeedbackSubmit}>
        <div className="feedback-header">
          <h3>Rate this Report</h3>
          <button type="button" className="feedback-close-btn" onClick={() => setShowFeedback(false)}>×</button>
        </div>
        <div className="rating-container">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              className={`star-button ${star <= feedback.rating ? "active" : ""}`}
              onClick={() => setFeedback((prev) => ({ ...prev, rating: star }))}
            >
              ★
            </button>
          ))}
        </div>
        <textarea
          className="feedback-textarea"
          placeholder="Share your thoughts about this report..."
          value={feedback.comments}
          onChange={(e) =>
            setFeedback((prev) => ({ ...prev, comments: e.target.value }))
          }
        />
        <button
          type="submit"
          className="feedback-submit"
          disabled={feedback.rating === 0}
        >
          Submit Feedback
        </button>
      </form>
    );
  };

  return (
    <div className="dashboard-container">
      {error && (
        <div className="alert-error">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <nav className="dashboard-nav">
        <div className="nav-left">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={activeTab === 'dashboard' ? 'active' : ''}
          >
            <i className="fas fa-tachometer-alt"></i> Dashboard
          </button>
          <button
            onClick={() => setActiveTab('register')}
            className={activeTab === 'register' ? 'active' : ''}
          >
            <i className="fas fa-user-plus"></i> {patientData ? 'Add Patient' : 'Register Patient'}
          </button>
          {patientData && (
            <button
              onClick={() => setActiveTab('report')}
              className={`nav-btn ${activeTab === 'report' ? 'active' : ''}`}
            >
              <i className="fas fa-file-alt"></i>  Report
            </button>
          )}
          <button
            className={`nav-btn ${activeTab === 'report-history' ? 'active' : ''}`}
            onClick={() => setActiveTab('report-history')}
          >
            <i className="fas fa-history"></i> Report History
          </button>
        </div>

        <div className="nav-right">
          <div className="notifications-container">
            <button
              className={`notifications-btn ${showNotifications ? 'active' : ''}`}
              onClick={() => setShowNotifications(!showNotifications)}
            >
              <i className="fas fa-bell"></i>
              {notifications.length > 0 && (
                <span className="notification-badge">{notifications.length}</span>
              )}
            </button>


            {showNotifications && (
              <div className="notifications-dropdown">
                <Notifications
                  items={notifications}
                  onMarkAllRead={handleMarkAllRead}
                />
              </div>
            )}

          </div>

          <div className={`profile-container ${showProfileDropdown ? 'show-dropdown' : ''}`}>
            <button
              className="profile-btn"
              onClick={() => setShowProfileDropdown(!showProfileDropdown)}
            >
              <i className="fas fa-user-circle"></i>  {username}
            </button>

            {showProfileDropdown && (
              <div className="profile-dropdown">
                <div className="profile-info">
                  <h3 className="usern">
                    User: Dr. <span className="un">{username}</span>
                  </h3>
                </div>
                <button
                  className="logout-btn"
                  onClick={handleLogout}
                >
                  <i className="fas fa-sign-out-alt"></i> Log Out
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <div className="dashboard-content">
        {isLoading && (
          <div className="loading-overlay">
            <div className="loading-spinner"></div>
            <p>Loading...</p>
          </div>
        )}

        {activeTab === 'dashboard' && patientData && (
          <div className="dashboard-main">
            <PatientStatsDoc
              stats={stats}
              patient={patientData}
              onMRIClick={() => setShowMRIModal(true)}
              onScheduleClick={() => setShowScheduleModal(true)}
              onMedicationClick={() => setShowMedicationModal(true)}
              apiBaseUrl={API_BASE_URL}
            />

            {/* MRI Upload Modal */}
            {showMRIModal && (
              <div className="modal-overlay">
                <div className="modal-content">
                  <div className="modal-header">
                    <h3>Upload MRI Scan for {patientData?.name || 'Patient'}</h3>
                    <button
                      className="modal-close-btn"
                      onClick={() => setShowMRIModal(false)}
                    >
                      &times;
                    </button>
                  </div>
                  <MRIScanUpload
                    apiBaseUrl={API_BASE_URL}
                    patientId={patientData.patient_id}
                    onUpload={async (result) => {
                      if (result.success) {
                        setShowMRIModal(false);
                        await fetchPatientData();
                      }
                    }}
                  />
                </div>
              </div>
            )}

            {/* Schedule Appointment Modal */}
            {showScheduleModal && (
              <div className="modal-overlay">
                <div className="modal-content">
                  <div className="modal-header">
                    <h3>Manage Appointments</h3>
                    <button
                      className="modal-close-btn"
                      onClick={() => setShowScheduleModal(false)}
                    >
                      &times;
                    </button>
                  </div>
                  <ScheduleAppointment
                    appointments={appointments}
                    onAddAppointment={handleAddAppointment}
                    onCompleteAppointment={handleCompleteAppointment}
                    apiBaseUrl={API_BASE_URL}
                  />
                </div>
              </div>
            )}

            {/* Add Medication Modal */}
            {showMedicationModal && (
              <div className="modal-overlay">
                <div className="modal-content">
                  <div className="modal-header">
                    <h3>Manage Medications</h3>
                    <button
                      className="modal-close-btn"
                      onClick={() => setShowMedicationModal(false)}
                    >
                      &times;
                    </button>
                  </div>
                  <AddMedication
                    medications={medications}
                    setMedications={setMedications}
                    onAddMedication={handleAddMedication}
                    onDeleteMedication={handleDeleteMedication}
                    patientData={patientData}
                    apiBaseUrl={API_BASE_URL}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'register' && (
          <div className="registration-section">
            <div className="section-header">
              <h2>{patientData ? 'Add New Patient' : 'Patient Registration'}</h2>
              <p>Please provide the patient's details below</p>
            </div>

            <div className="registration-type-selector">
              <button
                onClick={() => setRegistrationType('new')}
                className={registrationType === 'new' ? 'active' : ''}
              >
                <i className="fas fa-user-plus"></i> Register New Patient
              </button>
              <button
                onClick={() => setRegistrationType('existing')}
                className={registrationType === 'existing' ? 'active' : ''}
              >
                <i className="fas fa-link"></i> Link Existing Patient
              </button>
            </div>

            {registrationType === 'existing' ? (
              <div className="link-patient-form">
                <div className="form-group">
                  <label>Patient ID</label>
                  <input
                    type="text"
                    value={existingPatientId}
                    onChange={(e) => setExistingPatientId(e.target.value)}
                    placeholder="Enter patient ID"
                  />
                </div>
                <button
                  onClick={() => handlePatientRegistration({})}
                  className="submit-btn"
                  disabled={!existingPatientId.trim()}
                >
                  <i className="fas fa-link"></i> Link Patient
                </button>
              </div>
            ) : (
              <PatientRegistrationForm
                onSubmit={handlePatientRegistration}
                isLoading={isLoading}
              />
            )}
          </div>
        )}
        {activeTab === 'report' && (
          <div className="report-section">
            <div className="section-header">
              <h2>Patient Progress Report</h2>

              <div className="patient-selector">
                <label htmlFor="patient-select">Select Patient:</label>
                <select
                  id="patient-select"
                  value={selectedPatientId}
                  onChange={(e) => {
                    setSelectedPatientId(e.target.value);
                    fetchLatestReport(e.target.value);
                  }}
                  disabled={patients.length === 0}
                >
                  {patients.length > 0 ? (
                    patients.map(patient => (
                      <option key={patient.patient_id} value={patient.patient_id}>
                        {patient.name} ({patient.patient_id})
                      </option>
                    ))
                  ) : (
                    <option value="">No patients available</option>
                  )}
                </select>

                <button
                  onClick={() => fetchLatestReport(selectedPatientId)}
                  disabled={!selectedPatientId}
                  className="refresh-btn"
                >
                  <i className="fas fa-sync-alt"></i> Refresh
                </button>
              </div>

              {latestReport && (
                <div className="report-period">
                  <span>
                    {new Date(latestReport.period?.start || Date.now()).toLocaleDateString()} -
                    {new Date(latestReport.period?.end || Date.now()).toLocaleDateString()}
                  </span>
                  <span className="report-generated">
                    Generated: {new Date(latestReport.generated_at || Date.now()).toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            {error && (
              <div className="report-error-message">
                <i className="fas fa-info-circle"></i>
                <div className="error-content">
                  <p>{error}</p>
                  <div className="error-suggestions">
                    <p>Suggestions:</p>
                    <ul>
                      <li>Ensure the patient has completed some memory games</li>
                      <li>Check if there has been any recent game activity</li>
                      <li>Try refreshing the report</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {latestReport ? (
              <div>
                {renderReport(latestReport)}
                <button className="feedback-button" onClick={() => setShowFeedback(true)}>
                  <i className="fas fa-comment-alt"></i>
                  Provide Feedback
                </button>
              </div>
            ) : (
              <div className="no-report">
                <i className="fas fa-file-medical-alt"></i>
                <p>No report available. Click refresh to generate one.</p>
              </div>
            )}

            {showFeedback && (
              <div className="feedback-overlay">
                {renderFeedbackForm()}
              </div>
            )}
          </div>
        )}
        {activeTab === 'report-history' && (
          <div className="report-history-section">
            <div className="section-header">
              <h2>Report History</h2>
            </div>
            <ReportHistory
              patientId={selectedPatientId}
              patients={patients}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default DoctorHome;