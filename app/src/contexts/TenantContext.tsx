import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Tenant } from '../lib/database.types';
import { useAuth } from './AuthContext';

interface TenantContextValue {
  tenants: Tenant[];
  activeTenant: Tenant | null;
  loading: boolean;
  setActiveTenantId: (id: string) => void;
  createTenant: (name: string) => Promise<{ error: string | null }>;
  refresh: () => Promise<void>;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

const ACTIVE_TENANT_STORAGE_KEY = 'eneagrama.activeTenantId';

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_TENANT_STORAGE_KEY)
  );
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!user) {
      setTenants([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('tenants')
      .select('*')
      .order('created_at', { ascending: true });

    if (!error && data) {
      setTenants(data);
      if (data.length > 0 && !data.some((t) => t.id === activeTenantId)) {
        setActiveTenantId(data[0].id);
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function setActiveTenantId(id: string) {
    setActiveTenantIdState(id);
    localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, id);
  }

  async function createTenant(name: string) {
    const { data, error } = await supabase.rpc('create_tenant', { p_name: name });
    if (error) return { error: error.message };
    await refresh();
    if (data) setActiveTenantId((data as Tenant).id);
    return { error: null };
  }

  const activeTenant = tenants.find((t) => t.id === activeTenantId) ?? tenants[0] ?? null;

  return (
    <TenantContext.Provider
      value={{ tenants, activeTenant, loading, setActiveTenantId, createTenant, refresh }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant must be used within TenantProvider');
  return ctx;
}
