import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import DevScreenAgentHost from './components/DevScreenAgentHost.jsx';
import RenderIndicator from './components/RenderIndicator.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ActiveRenderProvider } from './context/ActiveRenderContext.jsx';
import { PageProvider } from './context/PageContext.jsx';
import { VaultProvider } from './context/VaultContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <ActiveRenderProvider>
              <PageProvider>
                <VaultProvider>
                  <App />
                  <DevScreenAgentHost />
                  <RenderIndicator />
                </VaultProvider>
              </PageProvider>
            </ActiveRenderProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
