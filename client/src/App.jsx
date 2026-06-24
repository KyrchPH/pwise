import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AdminRoute from './components/AdminRoute.jsx';
import ModuleRoute from './components/ModuleRoute.jsx';
import AppLayout from './components/AppLayout.jsx';
import LoginPage from './pages/Login/LoginPage.jsx';
import SignupPage from './pages/Signup/SignupPage.jsx';
import PrivacyPolicyPage from './pages/Privacy/PrivacyPolicyPage.jsx';
import DashboardPage from './pages/Dashboard/DashboardPage.jsx';
import ContentCalendarPage from './pages/ContentCalendar/ContentCalendarPage.jsx';
import AnalyticsPage from './pages/Analytics/AnalyticsPage.jsx';
import PostPoolPage from './pages/PostPool/PostPoolPage.jsx';
import UploadPostPage from './pages/UploadPost/UploadPostPage.jsx';
import ProductsPage from './pages/Products/ProductsPage.jsx';
import ShopLayout from './pages/Shop/ShopLayout.jsx';
import ComingSoon from './pages/Shop/ComingSoon.jsx';
import DiscountsPage from './pages/Shop/DiscountsPage.jsx';
import SettingsPage from './pages/Settings/SettingsPage.jsx';
import ChangePasswordPage from './pages/Profile/ChangePasswordPage.jsx';
import LogsPage from './pages/Logs/LogsPage.jsx';
import ActivityPage from './pages/Activity/ActivityPage.jsx';
import AccountsPage from './pages/Accounts/AccountsPage.jsx';
import MessagingPage from './pages/Messaging/MessagingPage.jsx';
import ConnectionsPage from './pages/Connections/ConnectionsPage.jsx';
import VaultPage from './pages/Vault/VaultPage.jsx';
import ProfilePage from './pages/Profile/ProfilePage.jsx';

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
        <Route path="/content-calendar" element={<ModuleRoute moduleId="content-calendar"><ContentCalendarPage /></ModuleRoute>} />
        <Route path="/analytics" element={<ModuleRoute moduleId="analytics"><AnalyticsPage /></ModuleRoute>} />
        <Route path="/post-pool" element={<ModuleRoute moduleId="post-pool"><PostPoolPage /></ModuleRoute>} />
        <Route path="/upload" element={<ModuleRoute moduleId="upload"><UploadPostPage /></ModuleRoute>} />
        <Route path="/shop" element={<ModuleRoute moduleId="products"><ShopLayout /></ModuleRoute>}>
          <Route index element={<Navigate to="/shop/products" replace />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="discounts" element={<DiscountsPage />} />
          <Route path="orders" element={<ComingSoon title="Orders" />} />
          <Route path="receipts" element={<ComingSoon title="Receipts" />} />
        </Route>
        <Route path="/products" element={<Navigate to="/shop/products" replace />} />
        <Route path="/settings" element={<ModuleRoute moduleId="settings"><SettingsPage /></ModuleRoute>} />
        <Route path="/settings/change-password" element={<Navigate to="/profile/change-password" replace />} />
        <Route path="/logs" element={<ModuleRoute moduleId="logs"><LogsPage /></ModuleRoute>} />
        <Route path="/activity" element={<ModuleRoute moduleId="activity"><ActivityPage /></ModuleRoute>} />
        <Route path="/accounts" element={<AdminRoute><ModuleRoute moduleId="accounts"><AccountsPage /></ModuleRoute></AdminRoute>} />
        <Route path="/messages" element={<ModuleRoute moduleId="messages"><MessagingPage /></ModuleRoute>} />
        <Route path="/connections" element={<ModuleRoute moduleId="connections"><ConnectionsPage /></ModuleRoute>} />
        <Route path="/vault" element={<ModuleRoute moduleId="vault"><VaultPage /></ModuleRoute>} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/profile/change-password" element={<ChangePasswordPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
