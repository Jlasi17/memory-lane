import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './CardMatchingGame.css';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://127.0.0.1:8000';

const CardMatchingGame = () => {
  const navigate = useNavigate();
  const [cards, setCards] = useState([]);
  const [flipped, setFlipped] = useState([]);
  const [matched, setMatched] = useState([]);
  const [moves, setMoves] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [timer, setTimer] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [difficulty, setDifficulty] = useState('easy'); // Set default to 'easy'
  const [score, setScore] = useState(0);
  const [playerLevel, setPlayerLevel] = useState(1);
  const [playerExp, setPlayerExp] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [newLevel, setNewLevel] = useState(1);
  const [patientStage, setPatientStage] = useState('non_demented');

  // Game configurations based on difficulty and player level
  const DIFFICULTY_CONFIG = {
    'easy': { // Severe Dementia (Worst case)
      name: 'Easy',
      cardCount: 12,
      timeLimit: 240,
      matchPoints: 10,
      timeBonusDivisor: 20
    },
    'medium': { // Moderate Dementia
      name: 'Medium',
      cardCount: 16,
      timeLimit: 210,
      matchPoints: 15,
      timeBonusDivisor: 15
    },
    'hard': { // Mild Dementia
      name: 'Hard',
      cardCount: 20,
      timeLimit: 180,
      matchPoints: 20,
      timeBonusDivisor: 12
    },
    'expert': { // Very Mild Dementia
      name: 'Expert',
      cardCount: 24,
      timeLimit: 150,
      matchPoints: 25,
      timeBonusDivisor: 10
    },
    'master': { // No Dementia
      name: 'Master',
      cardCount: 30,
      timeLimit: 120,
      matchPoints: 30,
      timeBonusDivisor: 8
    }
  };
  // Add this right after your DIFFICULTY_CONFIG definition
    const getConfig = (stage) => {
      // Default to 'easy' if no stage is provided
      if (!stage) return DIFFICULTY_CONFIG['easy'];
      
      // Handle both numeric and text stages
      const stageMap = {
        '0': 'master',
        '1': 'expert',
        '2': 'hard',
        '3': 'medium',
        '4': 'easy',
        'non_demented': 'master',
        'very_mild': 'expert',
        'mild': 'hard',
        'moderate': 'medium',
        'severe': 'easy'
      };
      
      const key = stageMap[stage.toString().toLowerCase()] || 'easy';
      return DIFFICULTY_CONFIG[key];
    };

  // Symbols for cards (emoji or images)
  const symbols = [
    '🍎', '🍌', '🍒', '🍓', '🍊', '🍋', '🍍', '🥝', 
    '🍇', '🍉', '🍐', '🥥', '🍑', '🥭', '🍈', '🍏',
    '🥕', '🍆', '🥑', '🥦', '🧄', '🧅', '🥔', '🌽',
    '🫜', '🫛', '🫐', '🍈', '🥬', '🥒'
  ];
  useEffect(() => {
    const fetchPatientStage = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/patient_stats`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        const data = await response.json();
        const stage = data.patient.alzheimer_stage || 'non_demented';
        setPatientStage(stage);
        // Set difficulty based on stage
        const key = getConfig(stage);
        setDifficulty(key.name.toLowerCase()); // or store the key instead
      } catch (error) {
        console.error("Failed to fetch patient stage:", error);
      }
    };
    fetchPatientStage();
  }, []);
 // After game completion in Card Matching game
const checkForPromotion = async () => {
  if (playerLevel >= 20 && playerLevel < 40 && patientStage === '3') {
    await promotePatient('4'); // Demote to more severe treatment if not improving
  } else if (playerLevel >= 40 && playerLevel < 50 && patientStage === '3') {
    await promotePatient('2'); // Improve to mild if doing well
  } else if (playerLevel >= 50 && patientStage === '2') {
    await promotePatient('1'); // Improve to very mild
  }
  // No promotion beyond very_mild
};

const adjustTreatmentBasedOnPerformance = async (performanceScore) => {
  try {
    // Get current patient stage
    const response = await fetch(`${API_BASE_URL}/api/patient_stats`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    const data = await response.json();
    const currentStage = data.patient.alzheimer_stage || '3'; // Default to moderate
    
    // Define thresholds for stage changes
    const stageThresholds = {
      '4': { improve: 20, worsen: 10 }, // Severe
      '3': { improve: 40, worsen: 20 }, // Moderate
      '2': { improve: 60, worsen: 30 }, // Mild
      '1': { improve: 80, worsen: 40 }, // Very Mild
      '0': { improve: 100, worsen: 50 }  // No dementia
    };
    
    let newStage = currentStage;
    const thresholds = stageThresholds[currentStage];
    
    if (performanceScore >= thresholds.improve) {
      // Improve treatment (lower stage number)
      if (currentStage !== '0') {
        newStage = String(Number(currentStage) - 1);
      }
    } else if (performanceScore < thresholds.worsen) {
      // Worsen treatment (higher stage number)
      if (currentStage !== '4') {
        newStage = String(Number(currentStage) + 1);
      }
    }
    
    // Only update if changed
    if (newStage !== currentStage) {
      await fetch(`${API_BASE_URL}/api/update_patient_stage`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ new_stage: newStage })
      });
      
      setMessage(`Treatment adjusted to ${getStageName(newStage)} based on your performance`);
    }
  } catch (error) {
    console.error('Error adjusting treatment:', error);
  }
};
// Add this function inside the CardMatchingGame component, before the return statement
const getStageName = (stage) => {
  const stages = {
    '0': 'No Dementia (Master)',
    '1': 'Very Mild Dementia (Expert)',
    '2': 'Mild Dementia (Hard)',
    '3': 'Moderate Dementia (Medium)',
    '4': 'Severe Dementia (Easy)'
  };
  return stages[stage] || 'Unknown Stage';
};

const promotePatient = async (newStage) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/update_patient_stage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        new_stage: newStage
      })
    });
    
    if (response.ok) {
      setPatientStage(newStage);
      setMessage(`Treatment plan updated to ${DIFFICULTY_CONFIG[newStage].name} difficulty.`);
    }
  } catch (error) {
    console.error("Error updating patient stage:", error);
  }
};
  // Initialize the game
  const initializeGame = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }
  
      // First get the current user's basic info to get their patient_id
      const userInfoResponse = await fetch(`${API_BASE_URL}/api/user`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!userInfoResponse.ok) {
        throw new Error('Failed to fetch user info');
      }
      
      const userInfo = await userInfoResponse.json();
      const patientId = userInfo.username; // Assuming username is the patient_id
  
      // Now fetch the game user profile using the patient_id
      const gameUserResponse = await fetch(`${API_BASE_URL}/api/game_user/${patientId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!gameUserResponse.ok) {
        // If we can't get the user profile, use defaults but still let the game start
        console.error('Failed to fetch game user data, using defaults');
        setPlayerLevel(1);
        setPlayerExp(0);
      } else {
        const userData = await gameUserResponse.json();
        setPlayerLevel(userData.level);
        setPlayerExp(userData.exp);
      }
      
  
      // Get the config based on patient stage
      const config = getConfig(patientStage);
      const pairs = symbols.slice(0, config.cardCount / 2);
      const deck = [...pairs, ...pairs];
      
      // Shuffle the deck
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
  
      // Update all state at once
      setCards(deck);
      setFlipped([]);
      setMatched([]);
      setMoves(0);
      setScore(0);
      setTimer(0);
      setIsRunning(true);
      setGameOver(false);
      setMessage('');
    } catch (error) {
      console.error("Error initializing game:", error);
      setMessage("Failed to initialize game - using default settings");
      // Set default values if there's an error
      setPlayerLevel(1);
      setPlayerExp(0);
    } finally {
      setLoading(false);
    }
  };

  // Handle card click
  const handleCardClick = (index) => {
    if (loading || gameOver || flipped.includes(index) || matched.includes(index) || flipped.length === 2) {
      return;
    }

    const newFlipped = [...flipped, index];
    setFlipped(newFlipped);

    if (newFlipped.length === 2) {
      setMoves(moves + 1);
      
      if (cards[newFlipped[0]] === cards[newFlipped[1]]) {
        // Match found
        const newMatched = [...matched, ...newFlipped];
        setMatched(newMatched);
        setFlipped([]);
        
        const config = DIFFICULTY_CONFIG[difficulty];
        setScore(score + config.matchPoints);
        
        // Check for game completion
        if (newMatched.length === cards.length) {
          const config = DIFFICULTY_CONFIG[difficulty];
          const timeRemaining = config.timeLimit - timer;
          const timeBonus = Math.floor(timeRemaining / config.timeBonusDivisor);
          const finalScore = score + config.matchPoints + timeBonus;
        
          endGame(true, {
            finalScore,
            baseScore: score + config.matchPoints,
            timeBonus,
            time: timer,
            matches: newMatched.length / 2,
            moves: moves + 1
          });
        }
      } else {
        // No match
        setTimeout(() => setFlipped([]), 1000);
      }
    }
  };

  // End game handler
  const endGame = async (completed, stats) => {
    setIsRunning(false);
    setGameOver(true);
  
    if (completed) {
      try {
        await adjustTreatmentBasedOnPerformance(stats.finalScore);
        setLoading(true);
        const response = await fetch(`${API_BASE_URL}/api/save-memory-score`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            score: stats.finalScore,
            base_score: stats.baseScore,
            time_bonus: stats.timeBonus,
            time: stats.time,
            level: playerLevel,
            difficulty: difficulty,
            time_limit: DIFFICULTY_CONFIG[difficulty].timeLimit,
            matches: stats.matches,
            moves: stats.moves
          })
        });
  
        const data = await response.json();
        setMessage(data.is_high_score ? '🌟 New High Score! 🌟' : 'Game completed!');
        if (data.levels_gained > 0) {
          setNewLevel(data.new_level);
          setShowLevelUp(true);
        }
  
        setPlayerLevel(data.new_level || playerLevel);
        setPlayerExp(prev => prev + (data.exp_gained || 0));
      } catch (error) {
        console.error('Error saving score:', error);
        setMessage(`Failed to save score: ${error.message}`);
      } finally {
        setLoading(false);
      }
    } else {
      setMessage("Time's up!");
    }
  };


  // Timer effect
  useEffect(() => {
    let interval;
    
    if (isRunning && !gameOver) {
      interval = setInterval(() => {
        setTimer(prev => {
          const newTime = prev + 1;
          if (newTime >= DIFFICULTY_CONFIG[difficulty].timeLimit) {
            endGame(false);
            return prev;
          }
          return newTime;
        });
      }, 1000);
    }
    
    return () => clearInterval(interval);
  }, [isRunning, gameOver, difficulty]);

  // Initialize game on mount and when difficulty changes
  useEffect(() => {
    initializeGame();
  }, [difficulty]);

  // Format time display
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Calculate progress to next level
  const expPercentage = playerLevel > 0 
    ? Math.min(100, (playerExp / (playerLevel * 100)) * 100)
    : 0;

  if (loading && cards.length === 0) {
    return (
      <div className="game-loading">
        <div className="spinner"></div>
        <p>Loading game...</p>
      </div>
    );
  }

  return (
    <div className="cardmatch-container">
      {/* Level Up Modal */}
      {showLevelUp && (
        <div className="level-up-modal">
          <div className="level-up-content">
            <div className="confetti">
              {[...Array(50)].map((_, i) => (
                <div key={i} className="confetti-piece" />
              ))}
            </div>
            <h2>Level Up!</h2>
            <h1 className="level-display">Level {newLevel}</h1>
            <p>Congratulations on your achievement!</p>
            <button 
              className="close-button"
              onClick={() => setShowLevelUp(false)}
            >
              Continue Playing
            </button>
          </div>
        </div>
      )}

      {/* Game Header */}
      <header className="cardmatch-header">
        <button className="cardmatch-back-button" onClick={() => navigate('/patient')}>
          ← Back to Home
        </button>
      </header>

      {/* Game Controls */}
      <div className="cardmatch-controls">
        <div className="cardmatch-difficulty-selector">
          <label>Difficulty:</label>
          <select 
            value={difficulty} 
            onChange={(e) => setDifficulty(e.target.value)}
          > 
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
            <option value="expert">Expert</option>
            <option value="master">Master</option>
          </select>
        </div>
        
        <div className="cardmatch-stats">
          <div className="cardmatch-stat">
            <span className="cardmatch-stat-label">Time:</span>
            <span className="cardmatch-stat-value">
              {formatTime(timer)} / {formatTime(DIFFICULTY_CONFIG[difficulty].timeLimit)}
            </span>
          </div>
          <div className="cardmatch-stat">
            <span className="cardmatch-stat-label">Moves:</span>
            <span className="cardmatch-stat-value">{moves}</span>
          </div>
          <div className="cardmatch-stat">
            <span className="cardmatch-stat-label">Score:</span>
            <span className="cardmatch-stat-value">{score}</span>
          </div>
        </div>
        
        <button 
          className="cardmatch-restart-button"
          onClick={initializeGame}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Restart Game'}
        </button>
      </div>

      {/* Game Message */}
      {message && (
        <div className="cardmatch-message">
          {message}
        </div>
      )}

      {/* Game Board */}
      <div 
        className="cardmatch-grid" 
        style={{
          gridTemplateColumns: `repeat(${Math.ceil(Math.sqrt(DIFFICULTY_CONFIG[difficulty].cardCount))}, 1fr)`
        }}
      >
        {cards.map((symbol, index) => {
          const isFlipped = flipped.includes(index) || matched.includes(index);
          const isMatched = matched.includes(index);
          
          return (
            <div
              key={index}
              className={`cardmatch-card ${isFlipped ? 'flipped' : ''} ${isMatched ? 'matched' : ''}`}
              onClick={() => handleCardClick(index)}
            >
              <div className="cardmatch-card-inner">
                <div className="cardmatch-card-front">
                  {symbol}
                </div>
                <div className="cardmatch-card-back">
                  <div className="cardmatch-card-back-pattern"></div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Game Over Modal */}
      {gameOver && (
        <div className="cardmatch-game-over-modal">
          <div className="cardmatch-modal-content">
            <h2>{matched.length === cards.length ? '🎉 You Won! 🎉' : "Game Over"}</h2>
            
            <div className="result-stats">
              <div className="result-stat">
                <span className="stat-label">Final Score:</span>
                <span className="stat-value">{score + Math.floor((DIFFICULTY_CONFIG[difficulty].timeLimit - timer) / DIFFICULTY_CONFIG[difficulty].timeBonusDivisor)}</span>
              </div>
              <div className="result-stat">
                <span className="stat-label">Time:</span>
                <span className="stat-value">{formatTime(timer)}</span>
              </div>
              <div className="result-stat">
                <span className="stat-label">Matches:</span>
                <span className="stat-value">{matched.length / 2}</span>
              </div>
              <div className="result-stat">
                <span className="stat-label">Moves:</span>
                <span className="stat-value">{moves}</span>
              </div>
            </div>

            <div className="modal-actions">
              <button 
                className="cardmatch-restart-button"
                onClick={initializeGame}
                disabled={loading}
              >
                Play Again
              </button>
              <button 
                className="cardmatch-back-button"
                onClick={() => navigate('/patient')}
              >
                Return to Dashboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CardMatchingGame;