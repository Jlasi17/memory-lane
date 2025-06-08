import { useState, useRef, useEffect } from 'react';
import './styles.css';

const ImageUpload = ({ onUpload, apiBaseUrl }) => {
  const [formData, setFormData] = useState({
    description: '',
    image_file: null,
    patient_id: '',
    type: 'situation', 
    person_name: '',
    relation_to_patient: ''
  });
  const [patients, setPatients] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const fileInputRef = useRef(null);

  // Fetch patients on component mount
  useEffect(() => {
    const fetchPatients = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/user_patients`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || 'Failed to fetch patients');
        }
        
        const data = await response.json();
        setPatients(data.patients || []);
        
        // Set default patient if available
        if (data.patients?.length > 0) {
          setFormData(prev => ({ ...prev, patient_id: "" }));
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoadingPatients(false);
      }
    };

    fetchPatients();
  }, [apiBaseUrl]);

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.size > 5 * 1024 * 1024) {
      setError("File size exceeds 5MB limit");
      return;
    }
    setFormData(prev => ({ ...prev, image_file: file }));
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsUploading(true);
    setError(null);
    setSuccess(null);
    
    try {
      // Validate form
      if (!formData.patient_id) {
        throw new Error("Please select a patient");
      }

      if (!formData.image_file) {
        throw new Error("Please select an image file");
      }

      // Additional validation for person type
      if (formData.type === 'person') {
        if (!formData.person_name) {
          throw new Error("Please enter the person's name");
        }
        if (!formData.relation_to_patient) {
          throw new Error("Please specify the relation to patient");
        }
      }

      const data = new FormData();
      data.append('image', formData.image_file);
      data.append('description', formData.description);
      data.append('patient_id', formData.patient_id);
      data.append('type', formData.type);
      
      // Only append person fields if type is 'person'
      if (formData.type === 'person') {
        data.append('person_name', formData.person_name);
        data.append('relation_to_patient', formData.relation_to_patient);
      }

      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const response = await fetch(`${apiBaseUrl}/api/upload_image`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: data
      });
      
      const result = await response.json();
      
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Upload failed');
      }
      
      // Success case
      setSuccess(result.message || 'Image uploaded successfully');
      onUpload(result);
      
      // Reset form (keep patient_id and type)
      setFormData(prev => ({
        description: '',
        image_file: null,
        patient_id: prev.patient_id,
        type: prev.type,
        person_name: '',
        relation_to_patient: ''
      }));
      
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      
    } catch (error) {
      console.error('Upload error:', error);
      setError(error.message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="image-upload">
      <h3>Upload Image</h3>
      
      {/* Success Message */}
      {success && (
        <div className="alert-success">
          {success}
          <button onClick={() => setSuccess(null)}>×</button>
        </div>
      )}
      
      {/* Error Message */}
      {error && (
        <div className="alert-error">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Image Type</label>
          <select
            name="type"
            value={formData.type}
            onChange={handleChange}
          >
            <option value="situation">Situation</option>
            <option value="person">Person Image</option>
          </select>
        </div>
        
        <div className="form-group">
          <label>Patient</label>
          {loadingPatients ? (
            <select disabled>
              <option>Loading patients...</option>
            </select>
          ) : (
            <select
              name="patient_id"
              value={formData.patient_id}
              onChange={handleChange}
              required
            >
              {patients.length === 0 ? (
                <option value="">No patients available</option>
              ) : (
                <>
                  <option value="">Select a patient</option>
                  {patients.map(patient => (
                    <option key={patient.patient_id} value={patient.patient_id}>
                      {patient.name} (ID: {patient.patient_id})
                    </option>
                  ))}
                </>
              )}
            </select>
          )}
        </div>
        
        {formData.type === 'person' && (
          <>
            <div className="form-group">
              <label>Person's Name</label>
              <input
                type="text"
                name="person_name"
                value={formData.person_name}
                onChange={handleChange}
                placeholder="Enter the person's name"
                required={formData.type === 'person'}
              />
            </div>
            
            <div className="form-group">
              <label>Relation to Patient</label>
              <input
                type="text"
                name="relation_to_patient"
                value={formData.relation_to_patient}
                onChange={handleChange}
                placeholder="E.g., Mother, Father, Doctor"
                required={formData.type === 'person'}
              />
            </div>
          </>
        )}
        
        <div className="form-group">
          <label>
            {formData.type === 'situation' ? 'Image Description' : 'Description of Person'}
          </label>
          <input
            type="text"
            name="description"
            value={formData.description}
            onChange={handleChange}
            placeholder={
              formData.type === 'situation' 
                ? "Describe the situation" 
                : "Describe the person (e.g., 'Grandma at birthday party')"
            }
            required
          />
        </div>
        
        <div className="form-group">
          <label>Image File (JPG/PNG, Max 5MB)</label>
          <input
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleFileChange}
            ref={fileInputRef}
            required
          />
        </div>
        
        <button 
          type="submit" 
          className="upload-btn"
          disabled={isUploading || patients.length === 0}
        >
          {isUploading ? (
            <>
              <span className="spinner"></span>
              Uploading...
            </>
          ) : `Upload ${formData.type === 'situation' ? 'Situation' : 'Person'} Image`}
        </button>
      </form>
    </div>
  );
};

export default ImageUpload;