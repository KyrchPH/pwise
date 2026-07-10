import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { AuthErrorScreen } from './components/ui.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AdminRoute from './components/AdminRoute.jsx';
import ModuleRoute from './components/ModuleRoute.jsx';
import AppLayout from './components/AppLayout.jsx';
import LoginPage from './pages/Login/LoginPage.jsx';
import SignupPage from './pages/Signup/SignupPage.jsx';
import PrivacyPolicyPage from './pages/Privacy/PrivacyPolicyPage.jsx';
import DashboardPage from './pages/Dashboard/DashboardPage.jsx';
import ContentCalendarPage from './pages/ContentCalendar/ContentCalendarPage.jsx';
import PlannerPage from './pages/Planner/PlannerPage.jsx';
import AnalyticsPage from './pages/Analytics/AnalyticsPage.jsx';
import InsightsPage from './pages/Insights/InsightsPage.jsx';
import ContentsView from './pages/PostPool/ContentsView.jsx';
import StoryViewPage from './pages/Stories/StoryViewPage.jsx';
import ProductsPage from './pages/Products/ProductsPage.jsx';
import ShopLayout from './pages/Shop/ShopLayout.jsx';
import DiscountsPage from './pages/Shop/DiscountsPage.jsx';
import OrdersPage from './pages/Shop/OrdersPage.jsx';
import ReceiptsPage from './pages/Shop/ReceiptsPage.jsx';
import SettingsPage from './pages/Settings/SettingsPage.jsx';
import ChangePasswordPage from './pages/Profile/ChangePasswordPage.jsx';
import LogsPage from './pages/Logs/LogsPage.jsx';
import ActivityPage from './pages/Activity/ActivityPage.jsx';
import AccountsPage from './pages/Accounts/AccountsPage.jsx';
import MessagingPage from './pages/Messaging/MessagingPage.jsx';
import ConnectionsPage from './pages/Connections/ConnectionsPage.jsx';
import VaultPage from './pages/Vault/VaultPage.jsx';
import ProfilePage from './pages/Profile/ProfilePage.jsx';
import CheckoutPage from './pages/Checkout/CheckoutPage.jsx';
import AgreementViewer from './pages/Agreement/AgreementViewer.jsx';
import SurveyPage from './pages/Survey/SurveyPage.jsx';
import PostInsightsPage from './pages/PostInsights/PostInsightsPage.jsx';

export default function App() {
  const { bootstrapError, retryBootstrap, retrying } = useAuth();

  // A server error while restoring the session blocks the whole app — including the
  // login page — behind a retry screen, so nobody tries to sign in against a down API.
  if (bootstrapError) return <AuthErrorScreen onRetry={retryBootstrap} busy={retrying} />;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} /> 
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/privacy" element={<PrivacyPolicyPage />} />
      {/* Standalone checkout tab — self-contained from a localStorage snapshot (see
          CheckoutPage), so it lives outside the app shell/auth gate. */}
      <Route path="/checkout" element={<CheckoutPage />} />
      {/* Public customer-facing order agreement — opened by the customer via a shared
          token link, so it lives outside the auth gate (the token is the capability). */}
      <Route path="/agreement/:token" element={<AgreementViewer />} />
      {/* Public customer satisfaction survey — opened from the emailed token link,
          so it also lives outside the auth gate (the token is the capability). */}
      <Route path="/survey/:token" element={<SurveyPage />} />
      {/* Per-post insights — opened in a NEW TAB from the post viewer's Insights button.
          Authed (JWT) but shell-less, so it's a focused, standalone metrics page. */}
      <Route path="/post/:id/insights" element={<ProtectedRoute><PostInsightsPage /></ProtectedRoute>} />

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
        <Route path="/planner" element={<ModuleRoute moduleId="planner"><PlannerPage /></ModuleRoute>} />
        <Route path="/analytics" element={<ModuleRoute moduleId="analytics"><AnalyticsPage /></ModuleRoute>} />
        <Route path="/insights" element={<ModuleRoute moduleId="insights"><InsightsPage /></ModuleRoute>} />
        <Route path="/post-pool" element={<ModuleRoute moduleId="post-pool"><ContentsView /></ModuleRoute>} />
        <Route path="/stories/:id" element={<ModuleRoute moduleId="post-pool"><StoryViewPage /></ModuleRoute>} />
        {/* Compose moved into Contents; keep /upload working for old links/bookmarks. */}
        <Route path="/upload" element={<Navigate to="/post-pool?view=compose&type=post" replace />} />
        <Route path="/shop" element={<ModuleRoute moduleId="products"><ShopLayout /></ModuleRoute>}>
          <Route index element={<Navigate to="/shop/products" replace />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="discounts" element={<DiscountsPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="receipts" element={<ReceiptsPage />} />
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
