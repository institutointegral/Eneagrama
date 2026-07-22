import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useTenant } from '../contexts/TenantContext';
import type { TenantWhatsappLink } from '../lib/database.types';

const CENTRAL_NUMBER = import.meta.env.VITE_WHATSAPP_CENTRAL_NUMBER as string | undefined;

function maskPhone(phone: string) {
  // Keep it readable without fully exposing the number in a shared screen.
  return phone.replace(/^(\d{2,4})\d+(\d{2})$/, '$1••••$2');
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function SettingsPage() {
  const { activeTenant } = useTenant();
  const [links, setLinks] = useState<TenantWhatsappLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    if (!activeTenant) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('tenant_whatsapp_links')
      .select('*')
      .eq('tenant_id', activeTenant.id)
      .order('created_at', { ascending: false });
    if (!error && data) setLinks(data);
    setLoading(false);
  }, [activeTenant]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Keeps the countdown on a pending code fresh without needing a manual reload.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  async function handleGenerate() {
    if (!activeTenant) return;
    setGenerating(true);
    setError(null);
    const { error } = await supabase.rpc('create_whatsapp_verification_code', {
      p_tenant_id: activeTenant.id,
    });
    setGenerating(false);
    if (error) {
      setError(error.message);
      return;
    }
    refresh();
  }

  const activeLink = links.find((l) => l.status === 'active');
  const pendingLink = links.find(
    (l) => l.status === 'pending' && new Date(l.code_expires_at).getTime() > now
  );

  const secondsLeft = pendingLink
    ? Math.max(0, Math.floor((new Date(pendingLink.code_expires_at).getTime() - now) / 1000))
    : 0;
  const minutesLeft = Math.floor(secondsLeft / 60);
  const secsLeft = secondsLeft % 60;

  return (
    <div>
      <div className="page-header">
        <h1>Configurações</h1>
      </div>

      <div className="section-title">Conectar WhatsApp</div>

      {loading ? (
        <p className="muted">Carregando...</p>
      ) : (
        <div className="card">
          {activeLink ? (
            <>
              <div className="card-row">
                <div>
                  <div className="card-title">Número conectado</div>
                  <div className="card-subtitle">{maskPhone(activeLink.phone_number ?? '')}</div>
                </div>
                <span className="badge settled">Ativo</span>
              </div>
              {activeLink.verified_at && (
                <p className="card-subtitle" style={{ marginTop: 6 }}>
                  Conectado em {formatDateTime(activeLink.verified_at)}
                </p>
              )}
            </>
          ) : (
            <p className="muted">Nenhum número conectado ainda.</p>
          )}

          {pendingLink ? (
            <div style={{ marginTop: 12 }}>
              <p className="muted">
                Envie o código abaixo pelo WhatsApp para o número oficial da plataforma
                {CENTRAL_NUMBER ? ` (${CENTRAL_NUMBER})` : ''} para{' '}
                {activeLink ? 'trocar o número conectado' : 'conectar seu número'}:
              </p>
              <div className="amount income" style={{ fontSize: '1.6em', letterSpacing: 4, marginTop: 8 }}>
                {pendingLink.verification_code}
              </div>
              <p className="card-subtitle" style={{ marginTop: 6 }}>
                Expira em {minutesLeft}:{String(secsLeft).padStart(2, '0')}
              </p>
            </div>
          ) : (
            <button
              type="button"
              className="primary-button"
              style={{ marginTop: 12 }}
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? 'Gerando...' : activeLink ? 'Gerar código para trocar de número' : 'Conectar WhatsApp'}
            </button>
          )}

          {error && <p className="error-text" style={{ marginTop: 8 }}>{error}</p>}
        </div>
      )}

      {!CENTRAL_NUMBER && (
        <p className="muted" style={{ marginTop: 12 }}>
          Número central da plataforma ainda não configurado nesta implantação
          (variável <code>VITE_WHATSAPP_CENTRAL_NUMBER</code>).
        </p>
      )}
    </div>
  );
}
