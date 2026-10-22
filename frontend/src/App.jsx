import React, { useState, useEffect } from 'react';
import { AudioProvider } from './context/AudioContext';
import { AlertProvider } from './context/AlertContext';
import { PatientProvider, usePatients } from './context/PatientContext';
import { Navbar } from './components/Navbar';
import { AlertBanner } from './components/AlertBanner';
import { Dashboard } from './pages/Dashboard';
import { Alerts } from './pages/Alerts';
import { LiveTracking } from './pages/LiveTracking';
import { sseClient } from './services/sseClient';
import { apiClient } from './services/apiClient';
import { StatusBadge } from './components/StatusBadge';
import {
  AlertTriangle,
  Info,
  ShieldAlert,
  Radio,
  Activity,
  Sliders,
  History,
  Users,
  Play,
  Moon,
  Zap,
} from 'lucide-react';

// Telemetry & Movement History View
const MovementHistoryView = () => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadHistory = () => {
    setLoading(true);
    apiClient
      .getTelemetryHistory(null, 50)
      .then((res) => {
        if (res && res.success) {
          setHistory(res.data);
          setError(null);
        } else {
          setError(res?.message || 'Failed to load telemetry history');
        }
      })
      .catch((err) => {
        console.warn('[History] Could not load telemetry history:', err);
        setError(err.message || 'Network error or database unavailable');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    loadHistory();
  }, []);

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <History color="#0ea5e9" size={26} />
          Movement &amp; Telemetry History
        </h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Historical sensor recordings of simulated patient kinematics, orientation angles, and gait classifications.
        </p>
      </div>

      <div className="glass-panel" style={{ padding: '20px', overflowX: 'auto' }}>
        {error ? (
          <div style={{ padding: '36px', textAlign: 'center', color: '#f87171' }}>
            <p style={{ fontWeight: 600 }}>Database Unavailable</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {error}
            </p>
            <button onClick={loadHistory} className="btn btn-sm btn-primary" style={{ marginTop: '14px' }}>
              Retry Loading
            </button>
          </div>
        ) : loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading movement history...
          </div>
        ) : history.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No recorded history packets yet. Trigger actions from the Dashboard or Simulation Controls.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '10px' }}>Timestamp</th>
                <th style={{ padding: '10px' }}>Device ID</th>
                <th style={{ padding: '10px' }}>Movement State</th>
                <th style={{ padding: '10px' }}>Accel (G)</th>
                <th style={{ padding: '10px' }}>Pitch / Roll</th>
                <th style={{ padding: '10px' }}>Alert Generated</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item, idx) => (
                <tr key={item._id || idx} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '10px', fontFamily: 'var(--font-mono)' }}>
                    {item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : '--'}
                  </td>
                  <td style={{ padding: '10px', fontFamily: 'var(--font-mono)' }}>{item.deviceId}</td>
                  <td style={{ padding: '10px' }}>
                    <StatusBadge status={item.movementState} type="movement" />
                  </td>
                  <td style={{ padding: '10px', fontFamily: 'var(--font-mono)' }}>
                    {item.metrics?.accelMagnitude?.toFixed(2) || '--'} G
                  </td>
                  <td style={{ padding: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                    {item.metrics?.pitch?.toFixed(1) || '--'}° / {item.metrics?.roll?.toFixed(1) || '--'}°
                  </td>
                  <td style={{ padding: '10px' }}>
                    {item.alertGenerated ? (
                      <span className="badge badge-critical">FALL IMPACT</span>
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

// Patient Roster View
const PatientsView = () => {
  const { patients, loading, error, refreshPatients } = usePatients();

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Users color="#0ea5e9" size={26} />
          Patient Roster &amp; Assigned Wearable Devices
        </h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Ward 3B patient directory, room assignments, and associated IoT telemetry tags.
        </p>
      </div>

      <div className="glass-panel" style={{ padding: '24px' }}>
        {error ? (
          <div style={{ padding: '36px', textAlign: 'center', color: '#f87171' }}>
            <p style={{ fontWeight: 600 }}>Database Unavailable</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {error}
            </p>
            <button onClick={refreshPatients} className="btn btn-sm btn-primary" style={{ marginTop: '14px' }}>
              Retry Connection
            </button>
          </div>
        ) : loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading patient roster...
          </div>
        ) : patients.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No patients currently enrolled in Ward 3B.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
            {patients.map((p) => (
              <div
                key={p._id}
                style={{
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                      Room {p.roomNumber} &bull; {p.bedNumber}
                    </span>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '2px' }}>{p.name}</h3>
                  </div>
                  <StatusBadge status={p.movementStatus} type="movement" />
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  <div>
                    Device Tag:{' '}
                    <strong style={{ color: 'var(--color-brand)', fontFamily: 'var(--font-mono)' }}>
                      {p.assignedDeviceId || 'None'}
                    </strong>
                  </div>
                  {p.notes && <p style={{ marginTop: '6px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Simulation Controls View
const SimulatorView = () => {
  const { patients } = usePatients();
  const [feedback, setFeedback] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);

  const triggerSim = async (type, patientId, name) => {
    try {
      if (type === 'walk') {
        await apiClient.simulateWalk(patientId);
        setFeedback(`Emitted simulated gait pattern for ${name}`);
      } else if (type === 'inactivity') {
        await apiClient.simulateInactivity(patientId);
        setFeedback(`Emitted simulated resting state for ${name}`);
      } else if (type === 'fall') {
        await apiClient.simulateFall(patientId);
        setFeedback(`🚨 Simulated Fall Event triggered for ${name}!`);
      }
      setTimeout(() => setFeedback(null), 4000);
    } catch (err) {
      setFeedback(`Simulation error: ${err.message}`);
    }
  };

  const handleToggleAuto = async () => {
    try {
      const next = !isSimulating;
      await apiClient.toggleAutoSimulation(next);
      setIsSimulating(next);
      setFeedback(`Automated telemetry simulation ${next ? 'started' : 'stopped'}.`);
      setTimeout(() => setFeedback(null), 3000);
    } catch (err) {
      setFeedback(`Error toggling auto simulation: ${err.message}`);
    }
  };

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Sliders color="#0ea5e9" size={26} />
          Simulation &amp; Kinematics Controls
        </h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Inject deterministic inertial sensor patterns to test rapid fall safeguard pipelines, SSE event dispatch, and audible triage alerts.
        </p>
      </div>

      {feedback && (
        <div
          style={{
            padding: '12px 18px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--color-brand)',
            fontSize: '0.9rem',
          }}
        >
          {feedback}
        </div>
      )}

      {/* Auto Simulation Loop Toggle */}
      <div className="glass-panel" style={{ padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Zap size={18} color="#0ea5e9" />
            Background Automated Telemetry Loop
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Periodically generates periodic gait and posture updates across all registered patients.
          </p>
        </div>
        <button
          onClick={handleToggleAuto}
          className={`btn ${isSimulating ? 'btn-danger' : 'btn-primary'}`}
        >
          {isSimulating ? 'Stop Auto Simulation' : 'Start Auto Simulation'}
        </button>
      </div>

      {/* Patient Injection Grid */}
      <div className="glass-panel" style={{ padding: '24px' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px' }}>
          Deterministic Event Injection by Patient
        </h3>

        {patients.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No patients found to simulate against.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
            {patients.map((p) => (
              <div
                key={p._id}
                style={{
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div>
                  <h4 style={{ fontWeight: 700 }}>{p.name}</h4>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    Room {p.roomNumber} &bull; Bed {p.bedNumber} &bull; Tag: {p.assignedDeviceId || 'N/A'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => triggerSim('walk', p._id, p.name)}
                    className="btn btn-sm btn-secondary"
                    style={{ flex: 1, fontSize: '0.75rem' }}
                  >
                    <Play size={12} /> Walk
                  </button>
                  <button
                    onClick={() => triggerSim('inactivity', p._id, p.name)}
                    className="btn btn-sm btn-secondary"
                    style={{ flex: 1, fontSize: '0.75rem' }}
                  >
                    <Moon size={12} /> Inactive
                  </button>
                  <button
                    onClick={() => triggerSim('fall', p._id, p.name)}
                    className="btn btn-sm btn-danger"
                    style={{ flex: 1, fontSize: '0.75rem' }}
                  >
                    <AlertTriangle size={12} /> Simulate Fall
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Main App Container
const AppContent = () => {
  const [activeTab, setActiveTab] = useState('dashboard');

  useEffect(() => {
    // Initiate Server-Sent Events listener
    sseClient.connect();
    return () => {
      sseClient.disconnect();
    };
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Global Real-time Fall Alert Banner */}
      <AlertBanner />

      {/* Navigation Header */}
      <Navbar activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Required Prototype & Clinical Disclaimer Header */}
      <section
        style={{
          background: 'linear-gradient(90deg, rgba(245, 158, 11, 0.12), rgba(14, 165, 233, 0.08))',
          borderBottom: '1px solid rgba(245, 158, 11, 0.25)',
          padding: '12px 24px',
        }}
      >
        <div
          style={{
            maxWidth: '1440px',
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(245, 158, 11, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#f59e0b',
                flexShrink: 0,
              }}
            >
              <AlertTriangle size={18} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '2px 6px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(245, 158, 11, 0.25)',
                    color: '#fbbf24',
                  }}
                >
                  Software Prototype
                </span>
                <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                  Hospital Mobility Monitoring
                </strong>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                <strong>Notice:</strong> This application is a software prototype for evaluation and research.
                Kinematic telemetry and rapid fall detection algorithms are <strong>simulated</strong> and are{' '}
                <strong>not clinically validated</strong> for diagnostic, life-critical, or unsupervised healthcare use.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontSize: '0.75rem',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
                background: 'var(--bg-surface-elevated)',
                padding: '4px 10px',
                borderRadius: 'var(--radius-full)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              Env: Development / Simulated
            </span>
          </div>
        </div>
      </section>

      {/* Main Routed Content Area */}
      <main style={{ flex: 1, paddingBottom: '40px' }}>
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'alerts' && <Alerts />}
        {activeTab === 'tracking' && <LiveTracking />}
        {activeTab === 'history' && <MovementHistoryView />}
        {activeTab === 'patients' && <PatientsView />}
        {activeTab === 'simulator' && <SimulatorView />}
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--border-subtle)',
          padding: '20px 24px',
          background: 'rgba(10, 15, 29, 0.6)',
          fontSize: '0.8rem',
          color: 'var(--text-muted)',
        }}
      >
        <div
          style={{
            maxWidth: '1440px',
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <strong>Hospital Mobility Monitoring</strong> &mdash; Inpatient Mobility Telemetry &amp; Simulated Fall Safeguard Prototype.
          </div>
          <div>
            Fall detection is simulated &bull; Not clinically validated for diagnostic use
          </div>
        </div>
      </footer>
    </div>
  );
};

export default function App() {
  return (
    <AudioProvider>
      <AlertProvider>
        <PatientProvider>
          <AppContent />
        </PatientProvider>
      </AlertProvider>
    </AudioProvider>
  );
}
