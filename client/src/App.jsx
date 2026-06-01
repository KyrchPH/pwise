import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AppLayout from './components/AppLayout.jsx';
import LoginPage from './pages/Login/LoginPage.jsx';
import DashboardPage from './pages/Dashboard/DashboardPage.jsx';
import PostPoolPage from './pages/PostPool/PostPoolPage.jsx';
import UploadPostPage from './pages/UploadPost/UploadPostPage.jsx';
import SettingsPage from './pages/Settings/SettingsPage.jsx';
import LogsPage from './pages/Logs/LogsPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/post-pool" element={<PostPoolPage />} />
        <Route path="/upload" element={<UploadPostPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/logs" element={<LogsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
