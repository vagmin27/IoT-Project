import React, { useState, useEffect } from 'react';
import { Activity, ShieldAlert, Radio, User, History, Sliders, Bell } from 'lucide-react';
import { sseClient } from '../services/sseClient';
import { AudioAlertController } from './AudioAlertController';
import { useAlerts } from '../context/AlertContext';
import { usePatients } from '../context/PatientContext';

export const Navbar = ({ activeTab, onTabChange }) => {
  const [sseStatus, setSseStatus] = useState('DISCONNECTED');
  const { activeAlerts, error: alertError } = useAlerts();
  const { error: patientError } = usePatients();
  const dbError = alertError || patientError;

  useEffect(() => {
    return sseClient.onStatusChange((status) => {
      setSseStatus(status);
    });
  }, []);

  const criticalCount = activeAlerts.filter((a) => a.severity === 'CRITICAL').length;

  const tabs = [
    { id: 'dashboard', label: 'Ward Dashboard', icon: Activity },
    { id: 'alerts', label: 'Alert Center', icon: ShieldAlert, badge: activeAlerts.length },
    { id: 'tracking', label: 'Live Telemetry', icon: Radio },
    { id: 'history', label: 'Movement History', icon: History },
    { id: 'patients', label: 'Patient Roster', icon: User },
    { id: 'simulator', label: 'Simulation Controls', icon: Sliders },
  ];

  return (
    <header
      style={{
        background: 'rgba(10, 15, 29, 0.85)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border-subtle)',
        position: 'sticky',
        top: 0,
        zIndex: 800,
        padding: '0 24px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '68px',
          maxWidth: '1440px',
          margin: '0 auto',
        }}
      >
        {/* Brand & Ward Identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, #0ea5e9, #0284c7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 15px rgba(14, 165, 233, 0.4)',
            }}
          >
            <Activity size={22} color="white" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '1.05rem', fontWeight: 800, letterSpacing: '-0.01em' }}>
                Hospital Mobility Monitor
              </h1>
              <span
                style={{
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 'var(--radius-full)',
                  background: 'rgba(14, 165, 233, 0.15)',
                  color: 'var(--color-brand)',
                  border: '1px solid rgba(14, 165, 233, 0.3)',
                }}
              >
                WARD 3B
              </span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Real-time Ingestion &amp; Automated Fall Safeguard
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 14px',
                  borderRadius: 'var(--radius-md)',
                  background: isActive ? 'var(--bg-surface-elevated)' : 'transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: isActive ? '1px solid rgba(14, 165, 233, 0.3)' : '1px solid transparent',
                  fontSize: '0.85rem',
                  fontWeight: isActive ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'var(--transition-smooth)',
                }}
              >
                <Icon size={16} color={isActive ? '#0ea5e9' : 'currentColor'} />
                <span>{tab.label}</span>
                {tab.badge > 0 && (
                  <span
                    style={{
                      background: criticalCount > 0 ? '#ef4444' : '#f59e0b',
                      color: 'white',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 'var(--radius-full)',
                    }}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Right Status Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* Database Connectivity Indicator if degraded */}
          {dbError && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 10px',
                borderRadius: 'var(--radius-full)',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#f87171',
              }}
              title={`Database status: ${dbError}`}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#ef4444' }} />
              <span>DB Unavailable</span>
            </div>
          )}

          {/* SSE Stream Status Indicator */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 10px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor:
                  sseStatus === 'CONNECTED'
                    ? '#10b981'
                    : sseStatus === 'CONNECTING'
                    ? '#f59e0b'
                    : '#ef4444',
              }}
              className={sseStatus === 'CONNECTED' ? 'animate-pulse-emerald' : ''}
            />
            <span style={{ color: 'var(--text-secondary)' }}>
              {sseStatus === 'CONNECTED'
                ? 'SSE Live'
                : sseStatus === 'CONNECTING'
                ? 'Reconnecting...'
                : 'Offline'}
            </span>
          </div>

          {/* Audio Chime Controller */}
          <AudioAlertController />
        </div>
      </div>
    </header>
  );
};
