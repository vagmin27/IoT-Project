import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiClient } from '../services/apiClient';
import { sseClient } from '../services/sseClient';

const PatientContext = createContext(null);

export const PatientProvider = ({ children }) => {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchPatients = useCallback(async () => {
    try {
      const res = await apiClient.getPatients();
      if (res.success) {
        setPatients(res.data);
      }
    } catch (err) {
      console.error('[PatientContext] Failed to fetch patients:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPatients();

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
      unsubStatus();
    };
  }, [fetchPatients]);

  return (
    <PatientContext.Provider value={{ patients, loading, refreshPatients: fetchPatients }}>
      {children}
    </PatientContext.Provider>
  );
};

export const usePatients = () => {
  const ctx = useContext(PatientContext);
  if (!ctx) throw new Error('usePatients must be used within a PatientProvider');
  return ctx;
};
