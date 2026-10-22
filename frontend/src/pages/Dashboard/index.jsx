import React, { useState } from 'react';
import { Activity, ShieldAlert, Moon, Footprints, AlertTriangle, Play, BedDouble } from 'lucide-react';
import { usePatients } from '../../context/PatientContext';
import { useAlerts } from '../../context/AlertContext';
import { StatusBadge } from '../../components/StatusBadge';
import { apiClient } from '../../services/apiClient';
import { AcknowledgeModal } from '../../components/AcknowledgeModal';

export const Dashboard = () => {
  const { patients, loading: patientsLoading, error: patientsError, refreshPatients } = usePatients();
  const { activeAlerts } = useAlerts();
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [actionFeedback, setActionFeedback] = useState(null);

  const walkingCount = patients.filter((p) => p.movementStatus === 'WALKING').length;
  const stationaryCount = patients.filter((p) => p.movementStatus === 'STATIONARY').length;
  const criticalCount = activeAlerts.filter((a) => a.severity === 'CRITICAL').length;

  const handleQuickTrigger = async (type, patientId, patientName) => {
    try {
      if (type === 'walk') {
        await apiClient.simulateWalk(patientId);
        setActionFeedback(`Emitted walking movement for ${patientName}`);
      } else if (type === 'inactivity') {
        await apiClient.simulateInactivity(patientId);
        setActionFeedback(`Emitted inactivity for ${patientName} (status updated, zero alerts)`);
      } else if (type === 'fall') {
        await apiClient.simulateFall(patientId);
        setActionFeedback(`🚨 Simulated Fall Impact triggered for ${patientName}!`);
      }
      setTimeout(() => setActionFeedback(null), 4000);
    } catch (err) {
      setActionFeedback(`Error: ${err.message}`);
    }
  };

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Banner Feedback */}
      {actionFeedback && (
        <div
          style={{
            padding: '12px 18px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--color-brand)',
            color: 'var(--text-primary)',
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{actionFeedback}</span>
          <button onClick={() => setActionFeedback(null)} className="btn btn-sm btn-secondary">
            Dismiss
          </button>
        </div>
      )}

      {/* Ward Status Overview Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Admitted Patients</span>
            <BedDouble size={20} color="#0ea5e9" />
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: '8px' }}>{patients.length}</div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Ward 3B Capacity: 8 Beds</span>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Currently Walking</span>
            <Footprints size={20} color="#10b981" />
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: '8px', color: '#10b981' }}>{walkingCount}</div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Normal rhythmic ambulation</span>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Stationary / Inactive</span>
            <Moon size={20} color="#f59e0b" />
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: '8px', color: '#f59e0b' }}>{stationaryCount}</div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Bed rest / resting state</span>
        </div>

        <div
          className="glass-panel"
          style={{
            padding: '20px',
            borderColor: criticalCount > 0 ? 'rgba(239, 68, 68, 0.4)' : undefined,
            background: criticalCount > 0 ? 'rgba(239, 68, 68, 0.1)' : undefined,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Active Fall Alerts</span>
            <ShieldAlert size={20} color={criticalCount > 0 ? '#ef4444' : '#64748b'} />
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: '8px', color: criticalCount > 0 ? '#ef4444' : 'var(--text-primary)' }}>
            {criticalCount}
          </div>
          <span style={{ fontSize: '0.75rem', color: criticalCount > 0 ? '#f87171' : 'var(--text-muted)' }}>
            {criticalCount > 0 ? 'Requires immediate response' : 'No active emergencies'}
          </span>
        </div>
      </div>

      {/* Main Ward Patient Grid */}
      <div className="glass-panel" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Ward 3B Bed &amp; Mobility Monitor</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Real-time patient mobility badges update automatically via Server-Sent Events (SSE).
            </p>
          </div>
        </div>

        {patientsError ? (
          <div style={{ padding: '36px', textAlign: 'center', color: '#f87171' }}>
            <AlertTriangle size={32} style={{ margin: '0 auto 10px auto', opacity: 0.8 }} />
            <p style={{ fontWeight: 600 }}>Database Unavailable</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {patientsError}
            </p>
            <button onClick={refreshPatients} className="btn btn-sm btn-primary" style={{ marginTop: '14px' }}>
              Retry Connection
            </button>
          </div>
        ) : patientsLoading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading ward telemetry...
          </div>
        ) : patients.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No admitted patients currently found in Ward 3B database.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
            {patients.map((patient) => {
              const hasCriticalAlert = activeAlerts.some(
                (a) => a.patientId?._id === patient._id || a.patientId === patient._id
              );

              return (
                <div
                  key={patient._id}
                  style={{
                    background: hasCriticalAlert ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-surface-elevated)',
                    border: hasCriticalAlert ? '1.5px solid #ef4444' : '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    transition: 'var(--transition-smooth)',
                  }}
                >
                  {/* Card Header: Room & Status */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--text-muted)',
                        }}
                      >
                        ROOM {patient.roomNumber} &bull; {patient.bedNumber}
                      </span>
                      <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: '2px' }}>
                        {patient.name}
                      </h3>
                    </div>
                    <StatusBadge status={patient.movementStatus} type="movement" />
                  </div>

                  {/* Device & Notes */}
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Device Tag:</span>
                      <strong style={{ color: 'var(--color-brand)', fontFamily: 'var(--font-mono)' }}>
                        {patient.assignedDeviceId || 'Unassigned'}
                      </strong>
                    </div>
                    {patient.notes && (
                      <p style={{ marginTop: '6px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {patient.notes}
                      </p>
                    )}
                  </div>

                  {/* Quick Simulation Triggers for this Patient */}
                  <div
                    style={{
                      marginTop: 'auto',
                      paddingTop: '10px',
                      borderTop: '1px solid var(--border-subtle)',
                      display: 'flex',
                      gap: '6px',
                    }}
                  >
                    <button
                      onClick={() => handleQuickTrigger('walk', patient._id, patient.name)}
                      className="btn btn-sm btn-secondary"
                      style={{ flex: 1, fontSize: '0.75rem', padding: '5px' }}
                      title="Inject deterministic walking pattern"
                    >
                      <Play size={12} /> Walk
                    </button>
                    <button
                      onClick={() => handleQuickTrigger('inactivity', patient._id, patient.name)}
                      className="btn btn-sm btn-secondary"
                      style={{ flex: 1, fontSize: '0.75rem', padding: '5px' }}
                      title="Inject inactivity (updates badge only, no alert)"
                    >
                      <Moon size={12} /> Inactive
                    </button>
                    <button
                      onClick={() => handleQuickTrigger('fall', patient._id, patient.name)}
                      className="btn btn-sm btn-danger"
                      style={{ flex: 1, fontSize: '0.75rem', padding: '5px' }}
                      title="Inject simulated fall impact (triggers CRITICAL alert)"
                    >
                      <AlertTriangle size={12} /> Fall
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Active Alerts Queue Table */}
      {activeAlerts.length > 0 && (
        <div className="glass-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <ShieldAlert size={20} color="#ef4444" />
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Active Incident Queue</h2>
            <span
              style={{
                background: '#ef4444',
                color: 'white',
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
              }}
            >
              {activeAlerts.length}
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '10px' }}>Incident Time</th>
                  <th style={{ padding: '10px' }}>Patient</th>
                  <th style={{ padding: '10px' }}>Location</th>
                  <th style={{ padding: '10px' }}>Severity</th>
                  <th style={{ padding: '10px' }}>Status</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {activeAlerts.map((alert) => (
                  <tr key={alert._id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '12px 10px', fontFamily: 'var(--font-mono)' }}>
                      {new Date(alert.triggeredAt).toLocaleTimeString()}
                    </td>
                    <td style={{ padding: '12px 10px', fontWeight: 600 }}>{alert.patientName}</td>
                    <td style={{ padding: '12px 10px' }}>
                      Room {alert.roomNumber} ({alert.bedNumber})
                    </td>
                    <td style={{ padding: '12px 10px' }}>
                      <StatusBadge status={alert.severity} type="severity" />
                    </td>
                    <td style={{ padding: '12px 10px' }}>
                      <StatusBadge status={alert.status} type="alertStatus" />
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'right' }}>
                      {alert.status === 'ACTIVE' ? (
                        <button
                          onClick={() => setSelectedAlert({ alert, mode: 'acknowledge' })}
                          className="btn btn-sm btn-primary"
                        >
                          Acknowledge
                        </button>
                      ) : (
                        <button
                          onClick={() => setSelectedAlert({ alert, mode: 'resolve' })}
                          className="btn btn-sm btn-success"
                        >
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {selectedAlert && (
        <AcknowledgeModal
          alert={selectedAlert.alert}
          mode={selectedAlert.mode}
          onClose={() => setSelectedAlert(null)}
        />
      )}
    </div>
  );
};
