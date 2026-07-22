import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { AdminTenantSummary, AdminTenantUser } from '../lib/database.types';

const WHATSAPP_STATUS_LABELS: Record<string, string> = {
  active: 'Conectado',
  pending: 'Código pendente',
  revoked: 'Desconectado',
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function AdminPage() {
  const [tenants, setTenants] = useState<AdminTenantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tenantUsers, setTenantUsers] = useState<AdminTenantUser[]>([]);
  const [busyTenantId, setBusyTenantId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc('admin_list_tenants');
    if (error) {
      setError(error.message);
    } else if (data) {
      setTenants(data as AdminTenantSummary[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function toggleExpand(tenantId: string) {
    if (expandedId === tenantId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(tenantId);
    const { data, error } = await supabase.rpc('admin_tenant_users', { p_tenant_id: tenantId });
    if (!error && data) setTenantUsers(data as AdminTenantUser[]);
  }

  async function toggleActive(tenant: AdminTenantSummary) {
    setBusyTenantId(tenant.tenant_id);
    const { error } = await supabase.rpc('admin_set_tenant_active', {
      p_tenant_id: tenant.tenant_id,
      p_is_active: !tenant.is_active,
    });
    setBusyTenantId(null);
    if (error) {
      alert(error.message);
      return;
    }
    refresh();
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tenants;
    return tenants.filter((t) => t.name.toLowerCase().includes(term));
  }, [tenants, search]);

  const health = useMemo(
    () => ({
      total: tenants.length,
      active: tenants.filter((t) => t.is_active).length,
      whatsappConnected: tenants.filter((t) => t.whatsapp_status === 'active').length,
      totalAccounts: tenants.reduce((sum, t) => sum + Number(t.account_count), 0),
      totalTransactions: tenants.reduce((sum, t) => sum + Number(t.transaction_count), 0),
    }),
    [tenants]
  );

  return (
    <div>
      <div className="page-header">
        <h1>Admin</h1>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="list" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="card-row">
            <div>
              <div className="card-subtitle">Tenants</div>
              <div className="card-title">
                {health.active} / {health.total} ativos
              </div>
            </div>
            <div>
              <div className="card-subtitle">WhatsApp conectado</div>
              <div className="card-title">{health.whatsappConnected}</div>
            </div>
          </div>
          <div className="card-subtitle" style={{ marginTop: 8 }}>
            {health.totalAccounts} contas · {health.totalTransactions} lançamentos na plataforma
          </div>
        </div>
      </div>

      <div className="filters">
        <input
          type="text"
          placeholder="Buscar por nome do tenant..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>

      {loading ? (
        <p className="muted">Carregando...</p>
      ) : filtered.length === 0 ? (
        <div className="empty-state">Nenhum tenant encontrado.</div>
      ) : (
        <div className="list">
          {filtered.map((t) => (
            <div key={t.tenant_id} className="card">
              <div className="card-row">
                <div>
                  <div className="card-title">
                    {t.name}
                    {!t.is_active && <span className="badge over">Inativo</span>}
                  </div>
                  <div className="card-subtitle">
                    {t.member_count} usuário(s) · {t.account_count} conta(s) · {t.transaction_count} lançamento(s)
                  </div>
                  <div className="card-subtitle">
                    WhatsApp: {t.whatsapp_status ? WHATSAPP_STATUS_LABELS[t.whatsapp_status] : 'Nunca conectado'}
                    {t.whatsapp_phone_number ? ` · ${t.whatsapp_phone_number}` : ''}
                  </div>
                  <div className="card-subtitle">Criado em {formatDateTime(t.created_at)}</div>
                </div>
              </div>
              <div className="card-actions">
                <button type="button" className="secondary-button" onClick={() => toggleExpand(t.tenant_id)}>
                  {expandedId === t.tenant_id ? 'Ocultar usuários' : 'Ver usuários'}
                </button>
                <button
                  type="button"
                  className={t.is_active ? 'danger-button' : 'secondary-button'}
                  onClick={() => toggleActive(t)}
                  disabled={busyTenantId === t.tenant_id}
                >
                  {t.is_active ? 'Desativar' : 'Ativar'}
                </button>
              </div>
              {expandedId === t.tenant_id && (
                <div className="list" style={{ marginTop: 10 }}>
                  {tenantUsers.length === 0 ? (
                    <p className="muted">Nenhum usuário encontrado.</p>
                  ) : (
                    tenantUsers.map((u) => (
                      <div key={u.user_id} className="card-row">
                        <span className="card-subtitle">
                          {u.email} · {u.role === 'owner' ? 'Owner' : 'Membro'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
