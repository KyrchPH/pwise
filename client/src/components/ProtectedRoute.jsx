import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { FullScreenSpinner } from './ui.jsx';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <FullScreenSpinner />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}
