import { useCallback, useEffect, useState } from 'react';
import type { AccountingPeriod, ExternalAccountingReferenceDocument } from '../../../modules/accounting/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { createExternalAccountingReferencesRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import type { EntityWithId } from '../../../modules/users/domain/models';

const accountingCallables = createAccountingCallables();

export function useExternalDocuments(period: AccountingPeriod) {
  const [documents, setDocuments] = useState<Array<EntityWithId<ExternalAccountingReferenceDocument>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const repository = createExternalAccountingReferencesRepository();
      setDocuments(await repository.listByPeriod(period));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar documentos externos.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    documents,
    loading,
    error,
    reload,
    recordExternalReference: accountingCallables.recordExternalReference,
    linkExternalReferenceToEmployee: accountingCallables.linkExternalReferenceToEmployee,
  };
}
