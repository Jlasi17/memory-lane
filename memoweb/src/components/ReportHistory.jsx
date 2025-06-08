import React, { useState, useEffect } from "react";
import { format } from "date-fns";
import "./ReportHistory.css";

const API_BASE_URL =
  process.env.REACT_APP_API_BASE_URL || "http://127.0.0.1:8000";

const ReportHistory = ({
  patientId: initialPatientId,
  patients: patientsList,
}) => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [selectedPatientId, setSelectedPatientId] = useState(
    initialPatientId || ""
  );
  const [filters, setFilters] = useState({
    startDate: "",
    endDate: "",
  });
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState({
    rating: 0,
    comments: "",
    submitted: false,
  });

  // Update selectedPatientId when initialPatientId changes
  useEffect(() => {
    if (initialPatientId) {
      setSelectedPatientId(initialPatientId);
    } else if (patientsList && patientsList.length > 0 && !selectedPatientId) {
      setSelectedPatientId(patientsList[0].patient_id);
    }
  }, [initialPatientId, patientsList]);

  const fetchReports = async (resetPage = false) => {
    if (!selectedPatientId) return;

    setLoading(true);
    setError(null);

    try {
      const queryParams = new URLSearchParams({
        patient_id: selectedPatientId,
        skip: resetPage ? 0 : page * 10,
        limit: 10
      });

      // Only add date filters if they have values
      if (filters.startDate) {
        queryParams.append('start_date', filters.startDate);
      }
      if (filters.endDate) {
        queryParams.append('end_date', filters.endDate);
      }

      const response = await fetch(`${API_BASE_URL}/api/reports/history?${queryParams}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch reports: ${response.statusText}`);
      }

      const data = await response.json();
      
      // If resetting page or applying new filters, replace the reports
      // Otherwise, append new reports for pagination
      setReports(resetPage ? data.reports : [...reports, ...data.reports]);
      setHasMore(data.has_more);
      setPage(resetPage ? 0 : page);
      
      if (data.reports.length === 0) {
        setError("No reports found for the selected period.");
      }
    } catch (error) {
      console.error("Error fetching reports:", error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedPatientId) {
      setPage(0);
      fetchReports(true);
    }
  }, [selectedPatientId]); // Remove filters dependency to prevent auto-fetching on filter change

  const handleLoadMore = () => {
    setPage((prev) => prev + 1);
    fetchReports(false);
  };

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handlePatientChange = (e) => {
    setSelectedPatientId(e.target.value);
  };

  const getTrendIcon = (change) => {
    if (change > 0) return "↑";
    if (change < 0) return "↓";
    return "→";
  };

  const getTrendClass = (change) => {
    if (change > 0) return "trend-up";
    if (change < 0) return "trend-down";
    return "trend-neutral";
  };

  const handleFeedbackSubmit = async (e) => {
    e.preventDefault();
    try {
      // First get the patient's treatment stage
      const patientResponse = await fetch(`${API_BASE_URL}/api/patients/${selectedPatientId}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
      });

      if (!patientResponse.ok) {
        throw new Error("Failed to fetch patient data");
      }

      const patientData = await patientResponse.json();
      const treatmentStage = patientData.alzheimer_stage || "0"; // Default to "0" if not set

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
          treatment_stage: treatmentStage
        }),
      });

      if (response.ok) {
        setFeedback((prev) => ({ ...prev, submitted: true }));
        setTimeout(() => {
          setShowFeedback(false);
          setFeedback({ rating: 0, comments: "", submitted: false });
        }, 3000);
      } else {
        throw new Error("Failed to submit feedback");
      }
    } catch (error) {
      console.error("Error submitting feedback:", error);
      setError("Failed to submit feedback. Please try again.");
    }
  };

  const renderFeedbackForm = () => {
    if (feedback.submitted) {
      return (
        <div className="feedback-form">
          <h3>Thank you for your feedback!</h3>
        </div>
      );
    }

    return (
      <form className="feedback-form" onSubmit={handleFeedbackSubmit}>
        <h3>Rate this Report</h3>
        <div className="rating-container">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              className={`star-button ${
                star <= feedback.rating ? "active" : ""
              }`}
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

  const renderReport = (report) => (
    <div key={report._id} className="report-card">
      <div className="report-header">
        <h3>
          Report for {format(new Date(report.generated_at), "MMM dd, yyyy")}
        </h3>
        <span className="report-type">{report.type}</span>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <h4>Engagement</h4>
          <p>{report.engagement?.sessions || 0} sessions</p>
          {report.trends && (
            <span className={getTrendClass(report.trends.engagement_change)}>
              {getTrendIcon(report.trends.engagement_change)}
              {Math.abs(report.trends.engagement_change || 0)}%
            </span>
          )}
        </div>

        <div className="metric-card">
          <h4>Improvement</h4>
          <p>{formatMetric(report.improvement?.percentage || 0)}%</p>
          <span>Games improved: {report.improvement?.games_improved || 0}</span>
        </div>

        <div className="metric-card">
          <h4>Efficiency</h4>
          <p>{formatMetric(report.efficiency?.ratio || 0)}</p>
          <span>{report.efficiency?.trend || 'No trend'}</span>
        </div>

        <div className="metric-card">
          <h4>Attention</h4>
          <p>{formatMetric(report.attention?.completion_rate || 0)}%</p>
          <span>Avg. Time: {formatMetric(report.attention?.average_time || 0)}s</span>
        </div>
      </div>

      {report.games && report.games.length > 0 && (
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
      )}
    </div>
  );

  const formatMetric = (value) => {
    if (value === undefined || value === null) return '0.00';
    return Number(value).toFixed(2);
  };

  const handleFilterSubmit = () => {
    // Validate date range
    if (filters.startDate && filters.endDate) {
      const start = new Date(filters.startDate);
      const end = new Date(filters.endDate);
      if (start > end) {
        setError("Start date cannot be later than end date");
        return;
      }
    }
    
    // Reset page and fetch with new filters
    setPage(0);
    fetchReports(true);
  };

  const handleResetFilters = () => {
    // Clear filters
    setFilters({
      startDate: '',
      endDate: ''
    });
    
    // Reset page and fetch without filters
    setPage(0);
    fetchReports(true);
  };

  if (loading && !reports.length) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="report-history">
      <div className="filters">
        <div className="filter-group">
          <label>Patient:</label>
          <select
            value={selectedPatientId}
            onChange={handlePatientChange}
            className="patient-select"
          >
            <option value="">Select Patient</option>
            {patientsList &&
              patientsList.map((patient) => (
                <option key={patient.patient_id} value={patient.patient_id}>
                  {patient.name} ({patient.patient_id})
                </option>
              ))}
          </select>
        </div>
        <div className="filter-group">
          <label>Start Date:</label>
          <input
            type="date"
            name="startDate"
            value={filters.startDate}
            onChange={handleFilterChange}
          />
        </div>
        <div className="filter-group">
          <label>End Date:</label>
          <input
            type="date"
            name="endDate"
            value={filters.endDate}
            onChange={handleFilterChange}
          />
        </div>
        <div className="filter-actions">
          <button 
            className="filter-btn"
            onClick={handleFilterSubmit}
            disabled={!selectedPatientId}
          >
            <i className="fas fa-filter"></i> Apply Filters
          </button>
          <button 
            className="reset-btn"
            onClick={handleResetFilters}
            disabled={!filters.startDate && !filters.endDate}
          >
            <i className="fas fa-undo"></i> Reset
          </button>
        </div>
      </div>

      {error && (
        <div className="error-message">
          <i className="fas fa-info-circle"></i>
          {error}
        </div>
      )}

      {!selectedPatientId && (
        <div className="no-patient-message">
          Please select a patient to view their reports
        </div>
      )}

      {selectedPatientId && reports.length === 0 && !loading && !error && (
        <div className="no-reports-message">
          <i className="fas fa-chart-bar"></i>
          <p>No reports available for the selected period.</p>
          <p>Reports are generated based on game activity.</p>
        </div>
      )}

      <div className="reports-list">
        {reports.map((report) => renderReport(report))}
      </div>

      {showFeedback && (
        <div className="feedback-overlay">{renderFeedbackForm()}</div>
      )}

      {hasMore && (
        <button
          className="load-more-btn"
          onClick={handleLoadMore}
          disabled={loading}
        >
          {loading ? "Loading..." : "Load More"}
        </button>
      )}
    </div>
  );
};

export default ReportHistory;
