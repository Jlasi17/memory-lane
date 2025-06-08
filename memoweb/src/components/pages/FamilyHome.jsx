import { useState, useEffect } from 'react';
import React from "react";
import {
  PatientRegistrationForm,
  MRIScanUpload,
  ImageUpload,
  PatientStats,
  Notifications
} from '../index';
import './famstyles.css';
import ReportHistory from '../ReportHistory';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://127.0.0.1:8000';

const FamilyHome = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [patientData, setPatientData] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [registrationType, setRegistrationType] = useState('new');
  const [existingPatientId, setExistingPatientId] = useState('');
  const [showMRIModal, setShowMRIModal] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [username, setUsername] = useState('');
  const [showNotifications, setShowNotifications] = useState(false); 
  const [reportData, setReportData] = useState(null);
  const [latestReport, setLatestReport] = useState(null);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [patientsList, setPatientsList] = useState([]);
  const [message, setMessage] = useState(''); // Add this with your other useState hooks
  const [feedback, setFeedback] = useState({
    rating: 0,
    comments: '',
    submitted: false
  });
  const [showFeedback, setShowFeedback] = useState(false);
  
  const handleFeedbackSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/api/feedback`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          patient_id: selectedPatientId,
          rating: feedback.rating,
          comments: feedback.comments,
          treatment_stage: patientData.alzheimer_stage
        })
      });
  
      if (response.ok) {
        setFeedback(prev => ({ ...prev, submitted: true }));
        // Adjust treatment plan based on feedback
        await adjustTreatmentPlan(feedback.rating < 3);
        // No need to navigate here - we'll let the user click "Back to Report"
      }
    } catch (error) {
      console.error('Error submitting feedback:', error);
      setMessage('Failed to submit feedback. Please try again.');
    }
  };
  const adjustTreatmentPlan = async (isNegativeFeedback) => {
    try {
      const currentStage = patientData.alzheimer_stage;
      let newStage = currentStage;
      
      // Define stage progression (higher numbers = more severe)
      const stages = ['0', '1', '2', '3', '4']; // From no dementia to severe
      
      if (isNegativeFeedback) {
        // If bad feedback, move to more severe treatment (higher number)
        const currentIndex = stages.indexOf(currentStage);
        if (currentIndex < stages.length - 1) {
          newStage = stages[currentIndex + 1];
        }
      } else {
        // If good feedback, consider improving treatment (lower number)
        // But only if game performance also supports it
        const report = await fetchLatestReport(selectedPatientId);
        if (report?.improvement?.percentage > 10) { // 10% improvement threshold
          const currentIndex = stages.indexOf(currentStage);
          if (currentIndex > 0) {
            newStage = stages[currentIndex - 1];
          }
        }
      }
  
      if (newStage !== currentStage) {
        const response = await fetch(`${API_BASE_URL}/api/update_patient_stage`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ new_stage: newStage })
        });
  
        if (response.ok) {
          setMessage(`Treatment plan updated to ${getStageName(newStage)} based on feedback and performance`);
          fetchPatientData(); // Refresh patient data
        }
      }
    } catch (error) {
      console.error('Error adjusting treatment plan:', error);
    }
  };
  
  const getStageName = (stage) => {
    switch(stage) {
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
  
  const fetchPatientsList = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/user_patients`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch patients list');
      }
      
      const data = await response.json();
      setPatientsList(data.patients || []);
      
      // Auto-select the first patient if none is selected
      if (data.patients?.length > 0 && !selectedPatientId) {
        setSelectedPatientId(data.patients[0].patient_id);
      }
    } catch (error) {
      console.error('Error fetching patients list:', error);
      setError(error.message);
    }
  };

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

  // Check if patient exists on component mount
  useEffect(() => {
    const checkPatient = async () => {
      try {
        await fetchPatientData();
        await fetchNotifications();
        await fetchUsername();
        await fetchPatientsList(); 
      } catch (error) {
        console.log('No patient data found');
      }
    };
    checkPatient();
  }, []);
  const fetchReportData = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/generate_report`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
  
      if (!response.ok) {
        throw new Error('Failed to generate report');
      }
  
      const data = await response.json();
      setReportData(data);
    } catch (error) {
      console.error('Error generating report:', error);
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };
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
        throw new Error(`Failed to fetch patient data: ${response.status}`);
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

  const fetchNotifications = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/notifications`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await response.json();
      setNotifications(data);
    } catch (error) {
      console.error('Error fetching notifications:', error);
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
        // If the endpoint doesn't exist or returns an error
        throw new Error('User info not available');
      }
      
      const data = await response.json();
      setUsername(data.username || data.email || 'User');
    } catch (error) {
      console.error('Error fetching username:', error);
      // Fallback to getting email from token or using a default
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
  const handlePatientRegistration = async (formData) => {
    setIsLoading(true);
    setError(null); // Clear previous errors
    
    try {
      if (registrationType === 'existing') {
        // Validate existing patient ID
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
            name: "Linked Patient", // Required by backend model
            age: 65, // Required by backend model
            gender: "other", // Required by backend model
            email: `replay.test@gmail.com`, // Required by backend model
            phone: "0000000000", // Required by backend model
            // These fields will be ignored for existing patients
            medical_history: "",
            user_id: "",
            passcode: "",
            caretakers: [], // Backend will add current user to this
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

      // Frontend validation
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

  

  const handleImageUpload = async (imageData) => {
    setIsLoading(true);
    
    try {
        // Validate input data structure
        if (!imageData || typeof imageData !== 'object') {
            throw new Error('Invalid image data format');
        }

        // Validate required fields
        if (!imageData.file) {
            throw new Error('No image file selected');
        }
        if (!imageData.patient_id) {
            throw new Error('Patient ID is required');
        }

        // Validate file properties
        if (!(imageData.file instanceof File)) {
            throw new Error('Invalid file format');
        }
        if (!imageData.file.type.startsWith('image/')) {
            throw new Error('Only image files are allowed');
        }
        if (imageData.file.size > 5 * 1024 * 1024) {
            throw new Error('Image size exceeds 5MB limit');
        }

        const formData = new FormData();
        formData.append('image', imageData.file);
        formData.append('description', imageData.description || 'No description provided');
        formData.append('patient_id', imageData.patient_id);

        const token = localStorage.getItem('token');
        if (!token) {
            throw new Error('Authentication token missing');
        }

        // Add timeout for the fetch request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(`${API_BASE_URL}/api/upload_image`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData,
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        // Handle HTTP errors
        if (!response.ok) {
            let errorDetail = `Status: ${response.status}`;
            try {
                const errorData = await response.json();
                errorDetail = errorData.detail || JSON.stringify(errorData);
            } catch (e) {
                console.warn('Failed to parse error response');
            }
            throw new Error(`Upload failed: ${errorDetail}`);
        }

        const data = await response.json();
        
        // Verify the expected response structure
        if (!data.success) {
            throw new Error(data.message || 'Upload completed but reported failure');
        }

        // Refresh data
        await Promise.all([
            fetchNotifications(),
            fetchPatientData()
        ]);

        return {
            success: true,
            data: data,
            message: 'Image uploaded successfully'
        };

    } catch (error) {
        console.error('Image upload error:', error);
        return {
            success: false,
            error: error.message,
            message: error.message
        };
    } finally {
        setIsLoading(false);
    }
};

  const handleLogout = () => {
    localStorage.removeItem('token');
    window.location.href = '/'; 
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showProfileDropdown && !event.target.closest('.profile-container')) {
        setShowProfileDropdown(false);
      }
    };
  
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showProfileDropdown]);
 
  
  
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
                    <div>Sessions: {game.sessions || 0}</div>
                    <div>High Score: {game.high_score || 0}</div>
                    <div>Average: {formatMetric(game.average_score)}</div>
                    <div>Total Rounds: {game.total_rounds || 0}</div>
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
              <p>Please play some memory games to generate performance data.</p>
              
              <div className="error-suggestions">
                <p>Suggestions:</p>
                <ul>
                  <li>
                    <i className="fas fa-gamepad"></i>
                    Try out different memory games
                  </li>
                  <li>
                    <i className="fas fa-calendar-check"></i>
                    Set up regular gaming sessions
                  </li>
                  <li>
                    <i className="fas fa-chart-line"></i>
                    Check back after playing some games
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
    <div className="family-dashboard-container">
      {error && (
        <div className="family-alert-error">
          {error}
          <button className="dismiss-btn" onClick={() => setError(null)}>×</button>
        </div>
      )}

      <nav className="family-dashboard-nav">
        <div className="nav-left">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
          >
            <i className="fas fa-tachometer-alt"></i> Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('register')}
            className={`nav-btn ${activeTab === 'register' ? 'active' : ''}`}
          >
            <i className="fas fa-user-plus"></i> {patientData ? 'Add Patient' : 'Register Patient'}
          </button>
          {patientData && (
            <>
              <button 
                onClick={() => setActiveTab('report')}
                className={`nav-btn ${activeTab === 'report' ? 'active' : ''}`}
              >
                <i className="fas fa-file-alt"></i> Report
              </button>
              <button
                className={`nav-btn ${activeTab === 'report-history' ? 'active' : ''}`}
                onClick={() => setActiveTab('report-history')}
              >
                <i className="fas fa-history"></i> Report History
              </button>
            </>
          )}
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
                <Notifications items={notifications} />
              </div>
            )}
          </div>

          <div className={`profile-container ${showProfileDropdown ? 'show-dropdown' : ''}`}>
            <button 
              className="profile-btn"
              onClick={() => setShowProfileDropdown(!showProfileDropdown)}
            >
              <i className="fas fa-user-circle"></i> {username}
            </button>

            {showProfileDropdown && (
              <div className="profile-dropdown">
                <div className="profile-info">
                <h3 className="usern">
                    User: <span className="un">{username}</span>
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

      <div className="family-dashboard-content">
        {isLoading && (
          <div className="loading-overlay">
            <div className="loading-spinner"></div>
          </div>
        )}

        {activeTab === 'dashboard' && patientData && (
          <div className="dashboard-main">
            <PatientStats 
              stats={stats} 
              patient={patientData} 
              onMRIClick={() => setShowMRIModal(true)}
              onImageClick={() => setShowImageModal(true)}
              apiBaseUrl={API_BASE_URL}
            />

            {/* MRI Upload Modal */}
            {showMRIModal && (
              <div className="modal-overlay">
                <div className="modal-content">
                  <div className="modal-header">
                    <h3>Upload MRI Scan for {'Patient'}</h3>
                    <button 
                      className="modal-close-btn"
                      onClick={() => setShowMRIModal(false)}
                    >
                      &times;
                    </button>
                  </div>
                  <MRIScanUpload 
                    apiBaseUrl={API_BASE_URL}
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

            {/* Image Upload Modal */}
            {showImageModal && (
              <div className="modal-overlay">
                <div className="modal-content">
                  <div className="modal-header">
                    <h3>Upload Image for {'Patient'}</h3>
                    <button 
                      className="modal-close-btn"
                      onClick={() => setShowImageModal(false)}
                    >
                      &times;
                    </button>
                  </div>
                  <ImageUpload 
                    onUpload={handleImageUpload}
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
                className={`type-btn ${registrationType === 'new' ? 'active' : ''}`}
              >
                <i className="fas fa-user-plus"></i> Register New Patient
              </button>
              <button 
                onClick={() => setRegistrationType('existing')}
                className={`type-btn ${registrationType === 'existing' ? 'active' : ''}`}
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
              <h2>Progress Report</h2>
              
              <div className="patient-selector">
                <label htmlFor="patient-select">Select Patient:</label>
                <select
                  id="patient-select"
                  value={selectedPatientId}
                  onChange={(e) => {
                    setSelectedPatientId(e.target.value);
                    fetchLatestReport(e.target.value);
                  }}
                  disabled={patientsList.length === 0}
                >
                  {patientsList.length > 0 ? (
                    patientsList.map(patient => (
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
                      <li>Try playing some memory games</li>
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
              patients={patientsList}
              onRefresh={() => fetchLatestReport(selectedPatientId)}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default FamilyHome;