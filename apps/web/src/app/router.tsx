import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.store';
import { AppLayout } from '../components/layout/AppLayout';

// Public Pages
import { LoginPage } from '../features/auth/components/LoginPage';
import { RegisterPage } from '../features/auth/components/RegisterPage';

// Protected Pages
import { ProjectsPage } from '../features/projects/components/ProjectsPage';
import { ProjectDetailPage } from '../features/projects/components/ProjectDetailPage';
import { DeploymentDetailPage } from '../features/deployments/components/DeploymentDetailPage';
import { ApiKeysPage } from '../features/api-keys/components/ApiKeysPage';
import { AuditLogsPage } from '../features/audit-logs/components/AuditLogsPage';
import { WebhooksPage } from '../features/webhooks/components/WebhooksPage';
import { AnalyticsPage } from '../features/analytics/components/AnalyticsPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((state) => state.accessToken);
  
  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((state) => state.accessToken);
  
  if (token) {
    return <Navigate to="/projects" replace />;
  }

  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Routes>
      {/* Public Routes */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <div className="min-h-screen bg-[#09090b] text-[#fafafa] flex items-center justify-center p-6">
              <LoginPage />
            </div>
          </PublicRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicRoute>
            <div className="min-h-screen bg-[#09090b] text-[#fafafa] flex items-center justify-center p-6">
              <RegisterPage />
            </div>
          </PublicRoute>
        }
      />

      {/* Protected Layout Routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="projects/:projectId/deployments/:deploymentId" element={<DeploymentDetailPage />} />
        <Route path="api-keys" element={<ApiKeysPage />} />
        <Route path="audit-logs" element={<AuditLogsPage />} />
        <Route path="webhooks" element={<WebhooksPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Route>
    </Routes>
  );
}
