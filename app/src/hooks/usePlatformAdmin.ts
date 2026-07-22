import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext';

export function usePlatformAdmin() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase.rpc('is_platform_admin').then(({ data }) => {
      setIsAdmin(Boolean(data));
      setLoading(false);
    });
  }, [user]);

  return { isAdmin, loading };
}
