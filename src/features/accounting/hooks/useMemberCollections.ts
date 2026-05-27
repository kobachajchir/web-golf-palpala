import { useCallback, useEffect, useMemo, useState } from 'react';
import { createMembersRepository } from '../../../modules/users/infrastructure/firestore/repositories';
import type { EntityWithId, MemberDocument } from '../../../modules/users/domain/models';
import { generateMembershipFee, getMemberOpenItems } from '../api/memberBillingApi';
import type { OpenItem } from '../types/payment';
import { getCurrentAccountingPeriod, normalizeAccountingPeriod } from '../utils/accountingFormatters';

export function useMemberCollections(initialMemberId?: string | null, initialPeriod = getCurrentAccountingPeriod()) {
  const [period, setPeriod] = useState(() => normalizeAccountingPeriod(initialPeriod));
  const [members, setMembers] = useState<Array<EntityWithId<MemberDocument>>>([]);
  const [memberId, setMemberId] = useState(initialMemberId ?? '');
  const [openItems, setOpenItems] = useState<OpenItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOpenItems, setLoadingOpenItems] = useState(false);
  const [error, setError] = useState('');

  const selectedMember = useMemo(
    () => members.find((member) => member.id === memberId) ?? null,
    [memberId, members],
  );

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const repository = createMembersRepository();
      const nextMembers = await repository.listDirectory();
      setMembers(nextMembers);

      if (!memberId && initialMemberId && nextMembers.some((member) => member.id === initialMemberId)) {
        setMemberId(initialMemberId);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar los socios.');
    } finally {
      setLoading(false);
    }
  }, [initialMemberId, memberId]);

  const loadOpenItems = useCallback(async () => {
    if (!memberId) {
      setOpenItems([]);
      return;
    }

    setLoadingOpenItems(true);
    setError('');

    try {
      setOpenItems(await getMemberOpenItems(memberId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar la deuda del socio.');
    } finally {
      setLoadingOpenItems(false);
    }
  }, [memberId]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    void loadOpenItems();
  }, [loadOpenItems]);

  const generateFeeAndReload = useCallback(async () => {
    if (!memberId) {
      throw new Error('Selecciona un socio para generar la cuota.');
    }

    const result = await generateMembershipFee({
      memberId,
      period,
      reason: 'Generada desde el flujo de cobro.',
    });
    await loadOpenItems();
    return result;
  }, [loadOpenItems, memberId, period]);

  return {
    period,
    setPeriod,
    members,
    selectedMember,
    memberId,
    setMemberId,
    openItems,
    loading,
    loadingOpenItems,
    error,
    reloadOpenItems: loadOpenItems,
    generateFeeAndReload,
  };
}
