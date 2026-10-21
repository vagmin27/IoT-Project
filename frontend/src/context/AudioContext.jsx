import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

const AudioContext = createContext(null);

export const AudioProvider = ({ children }) => {
  const [isMuted, setIsMuted] = useState(() => {
    return localStorage.getItem('hospital_mobility_muted') === 'true';
  });
  const [isAutoplayBlocked, setIsAutoplayBlocked] = useState(false);
  const audioCtxRef = useRef(null);

  // Initialize Web Audio Context lazily on user interaction
  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        audioCtxRef.current = new AudioCtxClass();
      }
    }
    return audioCtxRef.current;
  };

  const resumeAudioContext = async () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
        setIsAutoplayBlocked(false);
        console.log('[Audio] AudioContext resumed successfully.');
      } catch (err) {
        console.warn('[Audio] Failed to resume AudioContext:', err);
      }
    } else {
      setIsAutoplayBlocked(false);
    }
  };

  const toggleMute = () => {
    setIsMuted((prev) => {
      const next = !prev;
      localStorage.setItem('hospital_mobility_muted', String(next));
      if (!next) {
        resumeAudioContext();
      }
      return next;
    });
  };

  /**
   * Synthesize high-priority two-tone clinical alert chime
   * Frequencies: 880Hz (A5) for 200ms -> 1174.66Hz (D6) for 350ms
   */
  const playEmergencyChime = async () => {
    if (isMuted) {
      console.log('[Audio] Emergency chime silenced (User Muted).');
      return;
    }

    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        setIsAutoplayBlocked(true);
        console.warn('[Audio] Browser blocked autoplay audio. Visual alerts active.');
        return;
      }

      const now = ctx.currentTime;

      // Master gain node
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.4, now);
      masterGain.gain.exponentialRampToValueAtTime(0.01, now + 0.65);
      masterGain.connect(ctx.destination);

      // Tone 1 (880Hz)
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);
      osc1.connect(masterGain);
      osc1.start(now);
      osc1.stop(now + 0.22);

      // Tone 2 (1174.66Hz - urgency interval)
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1174.66, now + 0.22);
      osc2.connect(masterGain);
      osc2.start(now + 0.22);
      osc2.stop(now + 0.65);
    } catch (err) {
      console.warn('[Audio] Non-fatal audio cue failure:', err);
    }
  };

  return (
    <AudioContext.Provider
      value={{
        isMuted,
        toggleMute,
        isAutoplayBlocked,
        resumeAudioContext,
        playEmergencyChime,
      }}
    >
      {children}
    </AudioContext.Provider>
  );
};

export const useAudioAlert = () => {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error('useAudioAlert must be used within an AudioProvider');
  }
  return context;
};
