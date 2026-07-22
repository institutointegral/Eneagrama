import { Link } from 'react-router-dom';
import { usePlatformAdmin } from '../hooks/usePlatformAdmin';

const ITEMS = [
  { to: '/accounts', label: 'Contas', description: 'Contas correntes, poupança, carteira, cartões de crédito' },
  { to: '/categories', label: 'Categorias', description: 'Categorias e subcategorias padrão e personalizadas' },
  { to: '/recurrences', label: 'Recorrências', description: 'Regras de lançamentos recorrentes' },
  { to: '/settings', label: 'Configurações', description: 'Conectar WhatsApp e preferências da conta' },
];

export function MorePage() {
  const { isAdmin } = usePlatformAdmin();

  return (
    <div>
      <div className="page-header">
        <h1>Mais</h1>
      </div>
      <div className="list">
        {ITEMS.map((item) => (
          <Link key={item.to} to={item.to} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
            <div className="card-title">{item.label}</div>
            <div className="card-subtitle">{item.description}</div>
          </Link>
        ))}
        {isAdmin && (
          <Link to="/admin" className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
            <div className="card-title">Admin</div>
            <div className="card-subtitle">Visão geral de todos os tenants da plataforma</div>
          </Link>
        )}
      </div>
    </div>
  );
}
