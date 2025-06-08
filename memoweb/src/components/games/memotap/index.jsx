import React, { useState, useEffect, useRef } from 'react';
import styles from './MemoTap.module.css';
import { useNavigate } from 'react-router-dom';

const API_BASE_URL = 'http://127.0.0.1:8000' || 'http://127.0.0.1:8000';

const COLORS = [
  '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF',
  '#00FFFF', '#FFA500', '#A52A2A', '#800080', '#008000',
  '#000080', '#808000', '#800000', '#008080', '#000000',
  '#C0C0C0', '#808080', '#FFD700', '#D2691E', '#8B008B',
  '#B22222', '#228B22', '#191970', '#8B4513', '#2E8B57'
];

function MemoTap() {
  const [gameState, setGameState] = useState('ready');
  const [round, setRound] = useState(1);
  const [sequence, setSequence] = useState([]);
  const [playerInput, setPlayerInput] = useState([]);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [numColors, setNumColors] = useState(4);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const animationFrameRef = useRef();
  const colorButtonsRef = useRef([]);
  const [patientStage, setPatientStage] = useState('non_demented');
  const navigate = useNavigate();

  // Determine number of colors based on round
  const getNumColors = (roundNum, stage) => {
    switch(stage) {
      case "4": // Severe Dementia (Worst case)
        return roundNum <= 5 ? 4 : 6;
      case "3": // Moderate Dementia
        return roundNum <= 5 ? 6 : 8;
      case "2": // Mild Dementia
        return roundNum <= 5 ? 8 : 10;
      case "1": // Very Mild Dementia
        return roundNum <= 5 ? 10 : 16;
      case "0": // No Dementia
        return 25;
      default:  // Default to Very Mild if stage not specified
        return roundNum <= 5 ? 10 : 16;
    }
  };
  useEffect(() => {
    const fetchPatientStage = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/patient_stats`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        const data = await response.json();
        setPatientStage(data.patient.alzheimer_stage || 'non_demented');
      } catch (error) {
        console.error("Failed to fetch patient stage:", error);
      }
    };
    fetchPatientStage();
  }, []);

  useEffect(() => {
    fetchHighScores();
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);
  
  const fetchHighScores = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/high-scores?game_name=memotap`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        console.error('Failed to fetch high scores');
        return;
      }
      
      const data = await response.json();
      
      // Safely handle the response
      if (data?.scores?.length > 0) {
        // Since we're filtering by game_name in the API call, we can just take the first score
        // because they're sorted in descending order
        setHighScore(data.scores[0]?.score || 0);
      } else {
        setHighScore(0);
      }
    } catch (error) {
      console.error('Error fetching high scores:', error);
      setHighScore(0);
    }
  };

  const startGame = async () => {
    setGameState('showing');
    setScore(0);
    setRound(1);
    setPlayerInput([]);
    await fetchHighScores(); // Fetch high scores at game start
    await generateSequence(1);
  };

  const showSequenceWithDelay = async (sequence) => {
    setGameState('showing');
    
    // Use requestAnimationFrame for smoother timing
    for (let i = 0; i < sequence.length; i++) {
      setHighlightedIndex(sequence[i]);
      
      await new Promise(resolve => {
        animationFrameRef.current = requestAnimationFrame(() => {
          setTimeout(resolve, 800); // Longer display time for better visibility
        });
      });
      
      setHighlightedIndex(-1);
      
      if (i < sequence.length - 1) {
        await new Promise(resolve => {
          animationFrameRef.current = requestAnimationFrame(() => {
            setTimeout(resolve, 300); // Pause between colors
          });
        });
      }
    }
    
    setGameState('playing');
    setPlayerInput([]);
  };

  const generateSequence = async (roundNum) => {
    try {
      const colorsCount = getNumColors(roundNum, patientStage);
      setNumColors(colorsCount);
      
      // Generate sequence using only the available colors
      const newSequence = Array.from({ length: roundNum }, () => 
        Math.floor(Math.random() * colorsCount)
      );
      setSequence(newSequence);
      
      await showSequenceWithDelay(newSequence);
    } catch (error) {
      console.error('Error generating sequence:', error);
    }
  };

  const handleColorClick = (colorIndex) => {
    if (gameState !== 'playing') return;

    const newPlayerInput = [...playerInput, colorIndex];
    setPlayerInput(newPlayerInput);

    if (sequence[newPlayerInput.length - 1] !== colorIndex) {
      gameOver();
      return;
    }

    if (newPlayerInput.length === sequence.length) {
      roundComplete();
    }
  };

  const roundComplete = () => {
    const newScore = score + round;
    setScore(newScore);
    
    if (round >= 25) {
      gameOver(true);
      return;
    }

    const newRound = round + 1;
    setRound(newRound);
    setGameState('showing');
    generateSequence(newRound);
  };

  const saveScore = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/save-score`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          score: score,
          game_name: 'memotap',  // Make sure this matches what backend expects
          rounds_completed: round - 1,
          // Add any other required fields
        }),
      });
  
      if (!response.ok) {
        const error = await response.json();
        console.error("Save score error:", error);
        throw new Error(error.detail || 'Failed to save score');
      }
  
      return await response.json();
    } catch (error) {
      console.error("Error saving score:", error);
      throw error;
    }
  };


  const gameOver = async (completedAll = false) => {
    setGameState('over');
    if (score > 0 || completedAll) {
      try {
        console.log("Attempting to save score:", score); // Debug
        const result = await saveScore();
        console.log("Save score result:", result); // Debug
        await fetchHighScores();
      } catch (error) {
        console.error("Failed to save score:", error);
      }
    }
  };

  return (
    <div className={styles.memotapContainer}>
      <div className={styles.memotapGame}>
        <button 
          className={styles.startButton}
          onClick={() => navigate('/patient')}
        >
          ← Back to Dashboard
        </button>
  
        <h1 className={styles.gameTitle}>MemoTap</h1>
  
        <div className={styles.gameInfo}>
          <p>Score: {score}</p>
          <p>Round: {round}</p>
          <p>High Score: {highScore}</p>
        </div>
  
        {gameState === 'ready' && (
          <button className={styles.startButton} onClick={startGame}>
            Start Game
          </button>
        )}
  
        {gameState === 'showing' && (
          <div className={styles.showingSequence}>
            <h2>Memorize the sequence!</h2>
          </div>
        )}
  
        {gameState === 'playing' && (
          <div className={styles.playing}>
            <h2>Your turn! Tap the sequence</h2>
            <p>Progress: {playerInput.length}/{sequence.length}</p>
          </div>
        )}
  
        {gameState === 'over' && (
          <div className={styles.gameOver}>
            <h2>Game Over!</h2>
            <p>You reached round {round} with a score of {score}</p>
            <button className={styles.startButton} onClick={startGame}>
              Play Again
            </button>
          </div>
        )}
  
        <div 
          className={styles.colorGrid}
          style={{ gridTemplateColumns: `repeat(${Math.ceil(Math.sqrt(numColors))}, 1fr)` }}
        >
          {COLORS.slice(0, numColors).map((color, index) => (
            <button
              key={index}
              className={`${styles.colorButton} ${highlightedIndex === index ? styles.glowing : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => handleColorClick(index)}
              disabled={gameState !== 'playing'}
              ref={el => colorButtonsRef.current[index] = el}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default MemoTap;