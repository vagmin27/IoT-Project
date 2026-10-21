import React from 'react';
import { Activity, Moon, AlertTriangle, CheckCircle } from 'lucide-react';

export const StatusBadge = ({ status, type = 'movement', className = '' }) => {
  if (type === 'movement') {
    if (status === 'WALKING') {
      return (
        <span className={`badge badge-walking ${className}`}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#10b981' }} className="animate-pulse-emerald" />
          <Activity size={13} />
          Walking
        </span>
      );
    }
    return (
      <span className={`badge badge-stationary ${className}`}>
        <Moon size={13} />
        Stationary
      </span>
    );
  }

  if (type === 'severity') {
    if (status === 'CRITICAL') {
      return (
        <span className={`badge badge-critical animate-pulse-critical ${className}`}>
          <AlertTriangle size={13} />
          Critical Fall
        </span>
      );
    }
    return (
      <span className={`badge badge-active ${className}`}>
        {status}
      </span>
    );
  }

  if (type === 'alertStatus') {
    if (status === 'ACTIVE') {
      return <span className={`badge badge-critical ${className}`}>Active</span>;
    }
    if (status === 'ACKNOWLEDGED') {
      return <span className={`badge badge-stationary ${className}`}>Acknowledged</span>;
    }
    return <span className={`badge badge-walking ${className}`}><CheckCircle size={12} /> Resolved</span>;
  }

  return <span className={`badge badge-active ${className}`}>{status}</span>;
};
