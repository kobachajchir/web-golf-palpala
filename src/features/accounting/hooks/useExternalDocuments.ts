import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountingPeriod, ExternalAccountingReferenceDocument } from '../../../modules/accounting/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { createExternalAccountingReferencesRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import type { EntityWithId } from '../../../modules/users/domain/models';

const accountingCallables = createAccountingCallables();

export function useExternalDocuments(period: AccountingPeriod) {
  const [documents, setDocuments] = useState<Array<EntityWithId<ExternalAccountingReferenceDocument>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);
  const loadedPeriod = useRef<AccountingPeriod | null>(null);

  const reload = useCallback(async (targetPeriod: AccountingPeriod = period) => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError('');

    try {
      const repository = createExternalAccountingReferencesRepository();
      const result = await repository.listByPeriod(targetPeriod);
      if (requestId === requestSequence.current) {
        setDocuments(result);
        loadedPeriod.current = targetPeriod;
      }
      return result;
    } catch (loadError) {
      if (requestId === requestSequence.current) {
        setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar documentos externos.');
        loadedPeriod.current = targetPeriod;
      }
      throw loadError;
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    if (loadedPeriod.current !== period) void reload().catch(() => undefined);
  }, [period, reload]);

  return {
    documents,
    loading,
    error,
    reload,
    recordExternalReference: accountingCallables.recordExternalReference,
    deleteExternalReference: accountingCallables.deleteExternalReference,
    linkExternalReferenceToEmployee: accountingCallables.linkExternalReferenceToEmployee,
  };
}
