import { useCallback, useEffect, useState } from 'react';
import type { AccountingPeriod, EntityWithId, MacroDebitSettlementDocument } from '../../../modules/accounting/domain/models';
import { getSettlements } from '../api/providerPaymentsApi';

export function useSettlements(period: AccountingPeriod) {
  const [settlements, setSettlements] = useState<Array<EntityWithId<MacroDebitSettlementDocument>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      setSettlements(await getSettlements({ period }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar liquidaciones.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    settlements,
    loading,
    error,
    reload,
  };
}
