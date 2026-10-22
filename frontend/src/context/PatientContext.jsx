import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiClient } from '../services/apiClient';
import { sseClient } from '../services/sseClient';

const PatientContext = createContext(null);

export const PatientProvider = ({ children }) => {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPatients = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.getPatients();
      if (res && res.success) {
        setPatients(res.data);
        setError(null);
      } else {
        setError(res?.message || 'Database unavailable');
      }
    } catch (err) {
      console.error('[PatientContext] Failed to fetch patients:', err);
      setError(err.message || 'Network error or database unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPatients();

    // Reconcile patient roster on SSE reconnection
    const unsubReconnect = sseClient.addReconnectListener(() => {
      console.log('[PatientContext] SSE reconnection detected, refreshing patients...');
      fetchPatients();
    });

    // Listen for real-time movement status badge updates
    const unsubStatus = sseClient.on('patient_status_updated', (update) => {
      console.log('[PatientContext] SSE patient_status_updated received:', update);
      setPatients((prev) =>
        prev.map((p) =>
          p._id === update.patientId
            ? {
                ...p,
                movementStatus: update.movementStatus,
                lastMovementUpdate: update.lastMovementUpdate || new Date(),
              }
            : p
        )
      );
    });

    return () => {
      unsubReconnect();
      unsubStatus();
    };
  }, [fetchPatients]);

  return (
    <PatientContext.Provider value={{ patients, loading, error, refreshPatients: fetchPatients }}>
      {children}
    </PatientContext.Provider>
  );
};

export const usePatients = () => {
  const ctx = useContext(PatientContext);
  if (!ctx) throw new Error('usePatients must be used within a PatientProvider');
  return ctx;
};
