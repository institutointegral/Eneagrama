import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useTenant } from './contexts/TenantContext';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { CreateTenantPage } from './pages/CreateTenantPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { AccountsPage } from './pages/AccountsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { RecurrencesPage } from './pages/RecurrencesPage';
import { GoalsPage } from './pages/GoalsPage';

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
        path="/"
        element={
          <RequireAuth>
            <RequireTenant>
              <Layout />
            </RequireTenant>
          </RequireAuth>
        }
      >
        <Route index element={<TransactionsPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="recurrences" element={<RecurrencesPage />} />
        <Route path="goals" element={<GoalsPage />} />
      </Route>
    </Routes>
  );
}
