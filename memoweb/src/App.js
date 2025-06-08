// src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import './styles/design-system.css';
import AuthPage from './components/Auth/AuthPage';
import FamilyHome from './components/pages/FamilyHome';
import LoginForm from './components/Auth/LoginForm';
import DoctorHome from './components/pages/DoctorHome';
import MemoTap from './components/games/memotap';
import PatientHome from './components/pages/PatientHome';
import CardMatchingGame from './components/games/CardMatching/CardMatchingGame';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<AuthPage />} />
        <Route path="/login" element={<LoginForm />} />
        <Route path="/patient" element={<PatientHome />} />
        <Route path="/family" element={<FamilyHome />} />
        <Route path="/doctor" element={<DoctorHome />} />
        
        {/* Game Routes */}
        <Route path="/cardgame" element={<CardMatchingGame />} />
        <Route path="/memotap" element={<MemoTap />} />
      </Routes>
    </Router>
  );
}

export default App;