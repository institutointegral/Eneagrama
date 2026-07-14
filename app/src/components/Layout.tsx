import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';

const NAV_ITEMS = [
  { to: '/', label: 'Lançamentos', end: true },
  { to: '/accounts', label: 'Contas' },
  { to: '/categories', label: 'Categorias' },
  { to: '/recurrences', label: 'Recorrências' },
  { to: '/goals', label: 'Metas' },
];

export function Layout() {
  const { signOut } = useAuth();
  const { tenants, activeTenant, setActiveTenantId } = useTenant();

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
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
