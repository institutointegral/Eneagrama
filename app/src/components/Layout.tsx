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

// /accounts, /categories, /recurrences and /settings are only reachable
// through "Mais", so that tab should read as active on those pages too.
const MORE_PREFIXES = ['/more', '/accounts', '/categories', '/recurrences', '/settings'];

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
        {activeTenant && (
          <select
            className="tenant-select"
            value={activeTenant.id}
            onChange={(e) => setActiveTenantId(e.target.value)}
            disabled={tenants.length <= 1}
            title={tenants.length <= 1 ? 'Você ainda participa de um único espaço financeiro' : undefined}
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
        {activeTenant && !activeTenant.is_active ? (
          <div className="empty-state">
            Este espaço financeiro foi desativado por um administrador da plataforma.
            Entre em contato com o suporte para mais informações.
          </div>
        ) : (
          <Outlet />
        )}
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
