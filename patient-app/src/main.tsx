import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import PatientLogin from './pages/PatientLogin';
import PatientPortal from './pages/PatientPortal';
import './index.css';

// Auto-update the service worker whenever a new version is deployed
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<PatientLogin />} />
        <Route path="/portal" element={<PatientPortal />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
