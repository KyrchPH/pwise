import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AdminRoute from './components/AdminRoute.jsx';
import AppLayout from './components/AppLayout.jsx';
import LoginPage from './pages/Login/LoginPage.jsx';
import SignupPage from './pages/Signup/SignupPage.jsx';
import PrivacyPolicyPage from './pages/Privacy/PrivacyPolicyPage.jsx';
import DashboardPage from './pages/Dashboard/DashboardPage.jsx';
import AnalyticsPage from './pages/Analytics/AnalyticsPage.jsx';
import PostPoolPage from './pages/PostPool/PostPoolPage.jsx';
import UploadPostPage from './pages/UploadPost/UploadPostPage.jsx';
import SettingsPage from './pages/Settings/SettingsPage.jsx';
import ChangePasswordPage from './pages/Settings/ChangePasswordPage.jsx';
import LogsPage from './pages/Logs/LogsPage.jsx';
import ActivityPage from './pages/Activity/ActivityPage.jsx';
import AccountsPage from './pages/Accounts/AccountsPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/privacy" element={<PrivacyPolicyPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/post-pool" element={<PostPoolPage />} />
        <Route path="/upload" element={<UploadPostPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/change-password" element={<ChangePasswordPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/accounts" element={<AdminRoute><AccountsPage /></AdminRoute>} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
