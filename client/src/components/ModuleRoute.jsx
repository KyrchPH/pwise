import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { canAccessModule } from '../config/modules.js';

export default function ModuleRoute({ moduleId, children }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!canAccessModule(user, moduleId)) {
    return <Navigate to="/dashboard" replace state={{ blockedPath: location.pathname }} />;
  }

  return children;
}

