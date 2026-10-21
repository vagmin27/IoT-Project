import React, { useState } from 'react';
import { AlertTriangle, Clock, MapPin, Check, X } from 'lucide-react';
import { useAlerts } from '../context/AlertContext';
import { AcknowledgeModal } from './AcknowledgeModal';

export const AlertBanner = () => {
  const { currentCriticalAlert, dismissCriticalModal } = useAlerts();
  const [showModal, setShowModal] = useState(false);

  if (!currentCriticalAlert) return null;

  return (
    <>
      <div
        className="animate-pulse-critical"
        style={{
          position: 'fixed',
          top: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(92%, 840px)',
          zIndex: 900,
          background: 'linear-gradient(135deg, #7f1d1d, #991b1b)',
          border: '2px solid #ef4444',
          borderRadius: 'var(--radius-lg)',
          padding: '16px 24px',
          boxShadow: 'var(--shadow-alert)',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        {/* Left Side Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AlertTriangle size={26} color="#fecaca" />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  background: '#ef4444',
                  color: 'white',
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  letterSpacing: '0.05em',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  textTransform: 'uppercase',
                }}
              >
                CRITICAL EMERGENCY
              </span>
              <span style={{ fontSize: '0.8rem', opacity: 0.9, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Clock size={12} />
                {new Date(currentCriticalAlert.triggeredAt).toLocaleTimeString()}
              </span>
            </div>

            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, marginTop: '2px' }}>
              FALL DETECTED: {currentCriticalAlert.patientName}
            </h2>

            <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem', opacity: 0.95, marginTop: '2px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <MapPin size={13} /> Room {currentCriticalAlert.roomNumber} ({currentCriticalAlert.bedNumber})
              </span>
              <span>Device: {currentCriticalAlert.deviceId}</span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => setShowModal(true)}
            className="btn btn-primary"
            style={{
              background: '#ffffff',
              color: '#991b1b',
              fontWeight: 700,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
          >
            <Check size={16} />
            Acknowledge & Triage
          </button>

          <button
            onClick={dismissCriticalModal}
            className="btn btn-sm btn-secondary"
            style={{
              background: 'rgba(0, 0, 0, 0.3)',
              color: 'white',
              border: 'none',
            }}
            title="Dismiss popup (alert remains active in queue)"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {showModal && (
        <AcknowledgeModal
          alert={currentCriticalAlert}
          mode="acknowledge"
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
};
