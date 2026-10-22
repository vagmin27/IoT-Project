import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiClient } from '../services/apiClient';
import { sseClient } from '../services/sseClient';
import { useAudioAlert } from './AudioContext';

const AlertContext = createContext(null);

export const AlertProvider = ({ children }) => {
  const [activeAlerts, setActiveAlerts] = useState([]);
  const [allAlerts, setAllAlerts] = useState([]);
  const [currentCriticalAlert, setCurrentCriticalAlert] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { playEmergencyChime } = useAudioAlert();

  // Reconcile active alerts from REST API
  const refreshAlerts = useCallback(async () => {
    try {
      setLoading(true);
      const [activeRes, allRes] = await Promise.all([
        apiClient.getActiveAlerts(),
        apiClient.getAllAlerts({ limit: 100 }),
      ]);
      if (activeRes && activeRes.success) setActiveAlerts(activeRes.data);
      if (allRes && allRes.success) setAllAlerts(allRes.data);
      setError(null);
    } catch (err) {
      console.error('[AlertContext] Failed to load alerts:', err);
      setError(err.message || 'Network error or database unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAlerts();

    // Register reconciliation callback for SSE reconnection
    const unsubReconnect = sseClient.addReconnectListener(() => {
      refreshAlerts();
    });

    // Listen for SSE alert_created
    const unsubCreated = sseClient.on('alert_created', (alert) => {
      console.log('[AlertContext] SSE alert_created received:', alert);
      setActiveAlerts((prev) => [alert, ...prev.filter((a) => a._id !== alert._id)]);
      setAllAlerts((prev) => [alert, ...prev.filter((a) => a._id !== alert._id)]);

      if (alert.severity === 'CRITICAL') {
        setCurrentCriticalAlert(alert);
        playEmergencyChime();
      }
    });

    // Listen for SSE alert_updated
    const unsubUpdated = sseClient.on('alert_updated', (updated) => {
      console.log('[AlertContext] SSE alert_updated received:', updated);
      if (updated.status === 'RESOLVED') {
        setActiveAlerts((prev) => prev.filter((a) => a._id !== updated._id));
      } else {
        setActiveAlerts((prev) =>
          prev.map((a) => (a._id === updated._id ? updated : a))
        );
      }
      setAllAlerts((prev) =>
        prev.map((a) => (a._id === updated._id ? updated : a))
      );

      // Dismiss critical modal if resolved
      setCurrentCriticalAlert((curr) => (curr && curr._id === updated._id ? null : curr));
    });

    return () => {
      unsubCreated();
      unsubUpdated();
    };
  }, [refreshAlerts, playEmergencyChime]);

  const acknowledgeAlert = async (id, staffId, notes) => {
    try {
      const res = await apiClient.acknowledgeAlert(id, staffId, notes);
      if (res.success) {
        // SSE broadcast will also update state, but update optimistically
        setActiveAlerts((prev) =>
          prev.map((a) => (a._id === id ? res.data : a))
        );
      }
      return res;
    } catch (err) {
      console.error('[AlertContext] Error acknowledging alert:', err);
      throw err;
    }
  };

  const resolveAlert = async (id, staffId, notes) => {
    try {
      const res = await apiClient.resolveAlert(id, staffId, notes);
      if (res.success) {
        setActiveAlerts((prev) => prev.filter((a) => a._id !== id));
      }
      return res;
    } catch (err) {
      console.error('[AlertContext] Error resolving alert:', err);
      throw err;
    }
  };

  const dismissCriticalModal = () => {
    setCurrentCriticalAlert(null);
  };

  return (
    <AlertContext.Provider
      value={{
        activeAlerts,
        allAlerts,
        currentCriticalAlert,
        loading,
        error,
        refreshAlerts,
        acknowledgeAlert,
        resolveAlert,
        dismissCriticalModal,
      }}
    >
      {children}
    </AlertContext.Provider>
  );
};

export const useAlerts = () => {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error('useAlerts must be used within an AlertProvider');
  return ctx;
};
