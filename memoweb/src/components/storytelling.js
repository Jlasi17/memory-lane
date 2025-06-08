import React, { useState, useEffect } from 'react';
import './Storytelling.css';

const Storytelling = ({ patientId }) => {
  const [story, setStory] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStory = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`http://127.0.0.1:8000/api/storytelling/${patientId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `Failed to fetch story: ${response.status}`);
      }
      
      const data = await response.json();
      setStory(data.stories[0] || null);
    } catch (error) {
      console.error('Error fetching story:', error);
      const errorMessage = error.message.includes('No images found') 
        ? 'No memories have been uploaded yet. Please upload some images to generate stories.'
        : error.message.includes('Patient not found') 
          ? 'Unable to access stories for this patient. Please check your permissions.'
          : 'Unable to load story at this time. Please try again later.';
      setError(errorMessage);
      setStory(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (patientId) {
      fetchStory();
    } else {
      setError('No patient selected. Please select a patient to view their stories.');
      setIsLoading(false);
    }
  }, [patientId]);

  if (isLoading) {
    return <div className="storytelling-loading">Loading your memory story...</div>;
  }

  if (error) {
    return (
      <div className="storytelling-container">
        <div className="storytelling-error">
          <h2>Unable to Load Story</h2>
          <p>{error}</p>
          {error.includes('upload some images') && (
            <p className="storytelling-help">
              To create stories, first upload some memorable photos in the Photos section.
              Our AI will generate heartwarming stories based on your images.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!story) {
    return <div className="storytelling-empty">No story found. Please try again.</div>;
  }

  return (
    <div className="storytelling-container">
      <div className="storytelling-header">
        <h2>Memory Story</h2>
        <button onClick={fetchStory} className="refresh-button">
          Get Another Story
        </button>
      </div>
      <p className="stories-intro">Relive this special moment through a personalized story:</p>
      
      <div className="story-card">
        {story.image_url && (
          <div className="story-image-container">
            <img
              src={story.image_url}
              alt="Memory"
              className="story-image"
              onError={(e) => {
                console.error(`Image load error for ${story.image_url}`);
                e.target.style.display = 'none';
              }}
            />
          </div>
        )}
        <div className="story-content">
          <h3>{story.description || 'A Special Memory'}</h3>
          <div className="story-text">
            {story.story.split('\n').map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
          {story.uploaded_at && (
            <div className="story-date">
              Added on: {new Date(story.uploaded_at).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Storytelling;