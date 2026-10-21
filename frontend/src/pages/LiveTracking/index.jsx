import React, { useState, useEffect } from 'react';
import { Radio, Activity, Zap, Pause, Play, Trash2 } from 'lucide-react';
import { sseClient } from '../../services/sseClient';
import { StatusBadge } from '../../components/StatusBadge';

export const LiveTracking = () => {
  const [events, setEvents] = useState([]);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const unsub = sseClient.on('sensor_event', (eventData, eventId) => {
      if (isPaused) return;
      setEvents((prev) => [
        {
          ...eventData,
          sseEventId: eventId,
          receivedAt: new Date(),
        },
        ...prev.slice(0, 99), // Keep latest 100
      ]);
    });

    return () => unsub();
  }, [isPaused]);

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Radio color="#0ea5e9" size={26} />
            Real-Time Telemetry Stream (SSE)
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Live server-to-browser telemetry stream showing raw inertial measurements, sequence ordering, and fall detection triggers.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`btn btn-sm ${isPaused ? 'btn-primary' : 'btn-secondary'}`}
          >
            {isPaused ? <Play size={14} /> : <Pause size={14} />}
            {isPaused ? 'Resume Stream' : 'Pause Stream'}
          </button>
          <button onClick={() => setEvents([])} className="btn btn-sm btn-secondary">
            <Trash2 size={14} /> Clear Log
          </button>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '20px', overflowX: 'auto' }}>
        {events.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Activity size={32} style={{ margin: '0 auto 12px auto', opacity: 0.5 }} />
            <p>Awaiting incoming telemetry packets...</p>
            <p style={{ fontSize: '0.8rem', marginTop: '4px' }}>
              Tip: Go to Simulation Controls to trigger walking, stationary, or fall telemetry.
            </p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '10px' }}>Time</th>
                <th style={{ padding: '10px' }}>SSE ID</th>
                <th style={{ padding: '10px' }}>Device ID</th>
                <th style={{ padding: '10px' }}>Sequence</th>
                <th style={{ padding: '10px' }}>Movement State</th>
                <th style={{ padding: '10px' }}>Accel Magnitude</th>
                <th style={{ padding: '10px' }}>Orientation (Pitch/Roll)</th>
                <th style={{ padding: '10px' }}>Alert Triggered</th>
              </tr>
            </thead>
            <tbody>
              {events.map((evt, idx) => (
                <tr
                  key={evt.id || idx}
                  style={{
                    borderBottom: '1px solid var(--border-subtle)',
                    background: evt.alertGenerated ? 'rgba(239, 68, 68, 0.12)' : 'transparent',
                  }}
                >
                  <td style={{ padding: '10px', fontFamily: 'var(--font-mono)' }}>
                    {evt.receivedAt ? evt.receivedAt.toLocaleTimeString() : '--'}
                  </td>
                  <td style={{ padding: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-brand)' }}>
                    {evt.sseEventId ? `#${evt.sseEventId}` : '--'}
                  </td>
                  <td style={{ padding: '10px', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                    {evt.deviceId}
                  </td>
                  <td style={{ padding: '10px', fontFamily: 'var(--font-mono)' }}>
                    Seq {evt.sequenceNumber}
                  </td>
                  <td style={{ padding: '10px' }}>
                    <StatusBadge status={evt.movementState} type="movement" />
                  </td>
                  <td style={{ padding: '10px', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    <span style={{ color: evt.metrics?.accelMagnitude >= 2.8 ? '#ef4444' : 'inherit' }}>
                      {evt.metrics?.accelMagnitude?.toFixed(2)} G
                    </span>
                  </td>
                  <td style={{ padding: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                    {evt.metrics?.pitch?.toFixed(1)}° / {evt.metrics?.roll?.toFixed(1)}°
                  </td>
                  <td style={{ padding: '10px' }}>
                    {evt.alertGenerated ? (
                      <span className="badge badge-critical">CRITICAL ALERT</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>None</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
