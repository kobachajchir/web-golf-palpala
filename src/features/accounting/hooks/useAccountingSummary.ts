import { useCallback, useEffect, useState } from 'react';
import { getAccountingSummary } from '../api/accountingApi';
import type { AccountingSummary } from '../types/accounting';
import { getCurrentAccountingPeriod, normalizeAccountingPeriod } from '../utils/accountingFormatters';

export function useAccountingSummary(initialPeriod = getCurrentAccountingPeriod()) {
  const [period, setPeriod] = useState(() => normalizeAccountingPeriod(initialPeriod));
  const [summary, setSummary] = useState<AccountingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      setSummary(await getAccountingSummary(period));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar el resumen contable.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const refresh = () => { void reload(); };
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer); };
  }, [reload]);
  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    period,
    setPeriod,
    summary,
    loading,
    error,
    reload,
  };
}
