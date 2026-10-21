import React, { useState } from 'react';
import { X, ShieldAlert, Check, CheckCircle2 } from 'lucide-react';
import { useAlerts } from '../context/AlertContext';

export const AcknowledgeModal = ({ alert, mode = 'acknowledge', onClose }) => {
  const { acknowledgeAlert, resolveAlert } = useAlerts();
  const [staffId, setStaffId] = useState('RN-NURSE-01');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!alert) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (mode === 'acknowledge') {
        await acknowledgeAlert(alert._id, staffId, notes);
      } else {
        await resolveAlert(alert._id, staffId, notes);
      }
      onClose();
    } catch (err) {
      alert('Action failed: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          background: mode === 'acknowledge' ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.2), transparent)' : 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), transparent)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {mode === 'acknowledge' ? (
              <ShieldAlert size={22} color="#ef4444" />
            ) : (
              <CheckCircle2 size={22} color="#10b981" />
            )}
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                {mode === 'acknowledge' ? 'Acknowledge Emergency Fall Alert' : 'Resolve Incident Alert'}
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Patient: <strong style={{ color: '#fff' }}>{alert.patientName}</strong> &bull; Room {alert.roomNumber} ({alert.bedNumber})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '6px', color: 'var(--text-secondary)' }}>
              Staff Caregiver Identifier
            </label>
            <input
              type="text"
              required
              className="form-input"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              placeholder="e.g. RN-STAFF-104"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '6px', color: 'var(--text-secondary)' }}>
              Triage & Clinical Observations
            </label>
            <textarea
              className="form-input"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Responded within 30s. Patient attended at bedside, no head trauma observed."
            />
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`btn ${mode === 'acknowledge' ? 'btn-danger' : 'btn-success'}`}
            >
              {mode === 'acknowledge' ? <Check size={16} /> : <CheckCircle2 size={16} />}
              {isSubmitting ? 'Saving...' : mode === 'acknowledge' ? 'Confirm Acknowledgement' : 'Mark Resolved'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
