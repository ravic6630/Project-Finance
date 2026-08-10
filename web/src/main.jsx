import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { AppLockGate } from './components/AppLock.jsx';
import { initNative } from './lib/native.js';
import { AuthProvider } from './lib/AuthContext.jsx';
import { ConfirmProvider } from './lib/confirm.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppLockGate>
        <BrowserRouter>
        <AuthProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </AuthProvider>
        </BrowserRouter>
      </AppLockGate>
    </ErrorBoundary>
  </React.StrictMode>
);

// Native shell: hide the splash, wire Android's back button, watch connectivity.
initNative({
  onNetworkChange: (online) => document.body.classList.toggle('is-offline', !online),
});
