import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Category } from '../lib/database.types';
import { useTenant } from '../contexts/TenantContext';

export function useCategories() {
  const { activeTenant } = useTenant();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!activeTenant) {
      setCategories([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .or(`tenant_id.is.null,tenant_id.eq.${activeTenant.id}`)
      .order('name', { ascending: true });
    if (!error && data) setCategories(data);
    setLoading(false);
  }, [activeTenant]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { categories, loading, refresh };
}
