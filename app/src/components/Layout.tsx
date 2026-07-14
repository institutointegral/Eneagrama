import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';

const NAV_ITEMS = [
  { to: '/', label: 'Painel', end: true },
  { to: '/transactions', label: 'Lançamentos' },
  { to: '/cash-flow', label: 'Fluxo de Caixa' },
  { to: '/goals', label: 'Metas' },
  { to: '/more', label: 'Mais' },
];

// /accounts, /categories and /recurrences are only reachable through "Mais",
// so that tab should read as active on those pages too.
const MORE_PREFIXES = ['/more', '/accounts', '/categories', '/recurrences'];

export function Layout() {
  const { signOut } = useAuth();
  const { tenants, activeTenant, setActiveTenantId } = useTenant();
  const location = useLocation();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-top">
          <span className="app-title">Controle Financeiro</span>
          <button type="button" className="link-button" onClick={signOut}>
            Sair
          </button>
        </div>
        {tenants.length > 1 && (
          <select
            className="tenant-select"
            value={activeTenant?.id ?? ''}
            onChange={(e) => setActiveTenantId(e.target.value)}
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </header>

      <main className="app-content">
        <Outlet />
      </main>

      <nav className="app-nav">
        {NAV_ITEMS.map((item) => {
          const forcedActive = item.to === '/more' && MORE_PREFIXES.some((p) => location.pathname.startsWith(p));
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => 'nav-link' + (isActive || forcedActive ? ' active' : '')}
            >
              {item.label}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
