import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import './Notifications.css';

const Notifications = ({ items = [], onAction = () => {}, onMarkAllRead }) => {
  const handleAction = (notificationId, action) => {
    onAction(notificationId, action);
  };

  const formatTime = (timestamp) => {
    try {
      return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
    } catch (e) {
      return 'recently';
    }
  };

  if (!items || items.length === 0) {
    return (
      <div className="notifications-empty">
        <i className="fas fa-bell-slash"></i>
        <p>No new notifications</p>
      </div>
    );
  }

  return (
    <div className="notifications-container">
      <div className="notifications-header">
        <h3>Notifications</h3>
        {items.some(item => !item.read) && (
          <button 
            className="mark-read-btn"
            onClick={onMarkAllRead}
            title="Mark all as read"
          >
            <i className="fas fa-check"></i>
          </button>
        )}
      </div>
      <div className="notifications-list">
        {items.map((notification) => (
          <div 
            key={notification.id} 
            className={`notification-item ${notification.read ? 'read' : 'unread'} ${notification.priority ? `${notification.priority}-priority` : ''}`}
          >
            <div className="notification-title">
              {notification.title}
            </div>
            <div className="notification-message">
              {notification.message}
            </div>
            <div className="notification-time">
              {formatTime(notification.timestamp)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Notifications; 