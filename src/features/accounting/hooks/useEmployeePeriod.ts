import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountingPeriod } from '../../../modules/accounting/domain/models';
import { getEmployeePeriod } from '../api/employeeAccountingApi';
import type { EmployeeCycleSection, EmployeePeriodState } from '../types/employeeAccounting';
import { normalizeAccountingPeriod } from '../utils/accountingFormatters';

export function useEmployeePeriod(employeeId: string, period: string, initialSection: EmployeeCycleSection) {
  const [state, setState] = useState<EmployeePeriodState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current;
    if (!employeeId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const nextState = await getEmployeePeriod(employeeId, normalizeAccountingPeriod(period));
      if (requestId !== requestSequence.current) return;
      setState({
        ...nextState,
        expandedSection: initialSection,
      });
    } catch (loadError) {
      if (requestId !== requestSequence.current) return;
      setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar el ciclo mensual.');
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [employeeId, initialSection, period]);

  useEffect(() => {
    setState(null);
    void load();
    return () => { requestSequence.current += 1; };
  }, [load]);

  const setExpandedSection = (expandedSection: EmployeeCycleSection) => {
    setState((current) => (current ? { ...current, expandedSection } : current));
  };

  const setPeriod = (nextPeriod: AccountingPeriod) => {
    setState((current) => (current ? { ...current, period: nextPeriod } : current));
  };

  return {
    state,
    loading,
    error,
    reload: load,
    setExpandedSection,
    setPeriod,
  };
}
