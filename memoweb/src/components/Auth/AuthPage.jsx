import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import RoleSelection from './RoleSelection';
import LoginForm from './LoginForm';
import SignupForm from './SignupForm';
import './AuthPage.css';

const AuthPage = () => {
  const [authMode, setAuthMode] = useState('login');
  const [selectedRole, setSelectedRole] = useState(null);

  const handleRoleSelect = (role) => {
    setSelectedRole(role);
    if (role === 'patient') setAuthMode('login');
  };

  return (
    <div className="auth-container">
      <div className="auth-background">
        <div className="auth-shapes">
          <div className="shape shape-1"></div>
          <div className="shape shape-2"></div>
          <div className="shape shape-3"></div>
        </div>
      </div>

      <motion.div 
        className="auth-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="brand-section">
          <h1 className="app-title">Memory Lane</h1>
        </div>
        
        {!selectedRole ? (
          <motion.div
            key="role-selection"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <RoleSelection onRoleSelect={handleRoleSelect} />
          </motion.div>
        ) : (
          <div className="auth-forms-container">
            <button 
              className="back-button"
              onClick={() => setSelectedRole(null)}
            >
              ← 
            </button>
            
            <div className="auth-header">
              <button 
                className={`tab-button ${authMode === 'login' ? 'active' : ''}`}
                onClick={() => setAuthMode('login')}
              >
                Login
              </button>
              {selectedRole !== 'patient' && (
                <button 
                  className={`tab-button ${authMode === 'signup' ? 'active' : ''}`}
                  onClick={() => setAuthMode('signup')}
                >
                  Sign Up
                </button>
              )}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={authMode}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {authMode === 'login' ? (
                  <LoginForm role={selectedRole} />
                ) : (
                  <SignupForm role={selectedRole} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default AuthPage;