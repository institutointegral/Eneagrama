import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useTenant } from './contexts/TenantContext';
import { usePlatformAdmin } from './hooks/usePlatformAdmin';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { CreateTenantPage } from './pages/CreateTenantPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { AccountsPage } from './pages/AccountsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { RecurrencesPage } from './pages/RecurrencesPage';
import { GoalsPage } from './pages/GoalsPage';
import { DashboardPage } from './pages/DashboardPage';
import { CashFlowPage } from './pages/CashFlowPage';
import { MorePage } from './pages/MorePage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPage } from './pages/AdminPage';

function FullScreenLoader() {
  return (
    <div className="full-screen-loader">
      <p>Carregando...</p>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function RequireTenant({ children }: { children: ReactElement }) {
  const { activeTenant, loading } = useTenant();
  if (loading) return <FullScreenLoader />;
  if (!activeTenant) return <Navigate to="/onboarding" replace />;
  return children;
}

function RequirePlatformAdmin({ children }: { children: ReactElement }) {
  const { isAdmin, loading } = usePlatformAdmin();
  if (loading) return <FullScreenLoader />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/onboarding"
        element={
          <RequireAuth>
            <CreateTenantPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <RequirePlatformAdmin>
              <AdminPage />
            </RequirePlatformAdmin>
          </RequireAuth>
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <RequireTenant>
              <Layout />
            </RequireTenant>
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="cash-flow" element={<CashFlowPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="recurrences" element={<RecurrencesPage />} />
        <Route path="goals" element={<GoalsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="more" element={<MorePage />} />
      </Route>
    </Routes>
  );
}
