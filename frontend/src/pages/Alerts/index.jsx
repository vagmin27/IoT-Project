import React, { useState } from 'react';
import { ShieldAlert, Filter, Clock, CheckCircle2, UserCheck, MessageSquare } from 'lucide-react';
import { useAlerts } from '../../context/AlertContext';
import { StatusBadge } from '../../components/StatusBadge';
import { AcknowledgeModal } from '../../components/AcknowledgeModal';

export const Alerts = () => {
  const { allAlerts, refreshAlerts } = useAlerts();
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [modalData, setModalData] = useState(null);

  const filtered = allAlerts.filter((a) => {
    if (filterStatus === 'ALL') return true;
    return a.status === filterStatus;
  });

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ShieldAlert color="#ef4444" size={26} />
            Alert Management &amp; Triage Audit Log
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Complete historical audit trail of detected falls, triage responses, and resolution notes.
          </p>
        </div>

        {/* Filter Pills */}
        <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-surface-elevated)', padding: '4px', borderRadius: 'var(--radius-md)' }}>
          {['ALL', 'ACTIVE', 'ACKNOWLEDGED', 'RESOLVED'].map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className="btn btn-sm"
              style={{
                background: filterStatus === status ? 'var(--color-brand)' : 'transparent',
                color: filterStatus === status ? 'white' : 'var(--text-secondary)',
                fontSize: '0.75rem',
              }}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Alerts Table / Cards */}
      <div className="glass-panel" style={{ padding: '20px' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No incident records found for filter: {filterStatus}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filtered.map((alert) => (
              <div
                key={alert._id}
                style={{
                  background: 'var(--bg-surface-elevated)',
                  border: alert.status === 'ACTIVE' ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px 20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '16px',
                }}
              >
                {/* Left details */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <StatusBadge status={alert.severity} type="severity" />
                    <StatusBadge status={alert.status} type="alertStatus" />
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      Incident ID: {alert._id.slice(-6)}
                    </span>
                  </div>

                  <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '4px' }}>
                    {alert.patientName} &bull; Room {alert.roomNumber} ({alert.bedNumber})
                  </h3>

                  <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Clock size={12} /> Triggered: {new Date(alert.triggeredAt).toLocaleString()}
                    </span>
                    {alert.acknowledgedBy && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#f59e0b' }}>
                        <UserCheck size={12} /> Ack by: {alert.acknowledgedBy} ({new Date(alert.acknowledgedAt).toLocaleTimeString()})
                      </span>
                    )}
                    {alert.resolvedAt && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#10b981' }}>
                        <CheckCircle2 size={12} /> Resolved at: {new Date(alert.resolvedAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>

                  {alert.notes && (
                    <div
                      style={{
                        marginTop: '6px',
                        background: 'rgba(0,0,0,0.2)',
                        padding: '6px 12px',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <MessageSquare size={13} />
                      <em>{alert.notes}</em>
                    </div>
                  )}
                </div>

                {/* Right Action Buttons */}
                <div>
                  {alert.status === 'ACTIVE' && (
                    <button
                      onClick={() => setModalData({ alert, mode: 'acknowledge' })}
                      className="btn btn-primary btn-sm"
                    >
                      Acknowledge
                    </button>
                  )}
                  {alert.status === 'ACKNOWLEDGED' && (
                    <button
                      onClick={() => setModalData({ alert, mode: 'resolve' })}
                      className="btn btn-success btn-sm"
                    >
                      Resolve Incident
                    </button>
                  )}
                  {alert.status === 'RESOLVED' && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-safe)', fontWeight: 600 }}>
                      Closed
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalData && (
        <AcknowledgeModal
          alert={modalData.alert}
          mode={modalData.mode}
          onClose={() => setModalData(null)}
        />
      )}
    </div>
  );
};
