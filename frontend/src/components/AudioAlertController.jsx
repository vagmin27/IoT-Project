import React from 'react';
import { Volume2, VolumeX, AlertCircle } from 'lucide-react';
import { useAudioAlert } from '../context/AudioContext';

export const AudioAlertController = () => {
  const { isMuted, toggleMute, isAutoplayBlocked, resumeAudioContext } = useAudioAlert();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      {isAutoplayBlocked && (
        <button
          onClick={resumeAudioContext}
          className="btn btn-sm btn-primary"
          style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}
          title="Click to allow audible chime notifications"
        >
          <AlertCircle size={14} />
          Enable Alert Audio
        </button>
      )}

      <button
        onClick={toggleMute}
        className={`btn btn-sm ${isMuted ? 'btn-secondary' : 'btn-primary'}`}
        style={{
          border: isMuted ? '1px solid rgba(239, 68, 68, 0.4)' : undefined,
          color: isMuted ? '#f87171' : undefined,
        }}
        title={isMuted ? 'Audible alerts muted. Click to unmute.' : 'Audible alerts active. Click to mute.'}
      >
        {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        <span>{isMuted ? 'Muted' : 'Audio On'}</span>
      </button>
    </div>
  );
};
