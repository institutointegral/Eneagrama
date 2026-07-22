import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Account } from '../lib/database.types';
import { useTenant } from '../contexts/TenantContext';

export function useAccounts() {
  const { activeTenant } = useTenant();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!activeTenant) {
      setAccounts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('tenant_id', activeTenant.id)
      .order('created_at', { ascending: true });
    if (!error && data) setAccounts(data);
    setLoading(false);
  }, [activeTenant]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { accounts, loading, refresh };
}
