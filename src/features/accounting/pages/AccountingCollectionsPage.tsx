import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UiActionButton } from '../../../components/UiActionButton';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { AccountingMonthPicker } from '../components/AccountingMonthPicker';
import { ManualIncomeForm } from '../components/ManualIncomeForm';
import { MemberAccountSnapshot } from '../components/MemberAccountSnapshot';
import { MemberSearchPanel } from '../components/MemberSearchPanel';
import { PaymentComposer } from '../components/PaymentComposer';
import { ReceiptDrawer } from '../components/ReceiptDrawer';
import { createFinancialIncomeCategoriesRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import { useAccountingSummary } from '../hooks/useAccountingSummary';
import { useMemberCollections } from '../hooks/useMemberCollections';
import type { AccountingNotice } from '../types/accounting';
import type { ManualPaymentReceipt } from '../types/payment';
import type { IncomeCategoryOption } from '../utils/accountingCategories';
import { getFallbackIncomeCategories } from '../utils/accountingCategories';
import { getCurrentAccountingPeriod, normalizeAccountingPeriod, shiftAccountingPeriod } from '../utils/accountingFormatters';

import { isVisiblePaymentMethod } from '../utils/paymentMethods';

const MAX_FUTURE_MEMBER_FEE_PERIOD = shiftAccountingPeriod(getCurrentAccountingPeriod(), 24);

export function AccountingCollectionsPage({
  embedded = false,
  showManualIncomeForm = true,
  autoSelectOpenItems = false,
}: {
  embedded?: boolean;
  showManualIncomeForm?: boolean;
  autoSelectOpenItems?: boolean;
}) {
  const [searchParams] = useSearchParams();
  const modeParam = searchParams.get('mode');
  const memberIdParam = searchParams.get('memberId');
  const periodParam = searchParams.get('period');
  const collections = useMemberCollections(
    memberIdParam,
    periodParam ? normalizeAccountingPeriod(periodParam) : undefined,
    Boolean(periodParam),
  );
  const { summary, reload } = useAccountingSummary();
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [receipt, setReceipt] = useState<ManualPaymentReceipt | null>(null);
  const [incomeCategories, setIncomeCategories] = useState<IncomeCategoryOption[]>(() => getFallbackIncomeCategories());

  useEffect(() => {
    if (modeParam) {
      setNotice({ kind: 'info', message: 'Ese modo de cobro ya no esta disponible. Usa los medios activos del club.' });
    }
  }, [modeParam]);

  useEffect(() => {
    const repository = createFinancialIncomeCategoriesRepository();
    void repository
      .listActiveSorted()
      .then((categories) => {
        if (categories.length > 0) {
          setIncomeCategories(categories);
        }
      })
      .catch(() => setIncomeCategories(getFallbackIncomeCategories()));
  }, []);

  const paymentMethods = useMemo(() => {
    if (!summary?.paymentMethods.length) {
      return [];
    }

    return summary.paymentMethods.filter(isVisiblePaymentMethod);
  }, [summary?.paymentMethods]);

  const isMemberBlocked = collections.selectedMember?.status === 'inactive' || collections.selectedMember?.status === 'suspended';

  const handleGeneratedFee = async () => {
    setNotice(null);
    try {
      const result = await collections.generateFeeAndReload();
      setNotice({
        kind: 'success',
        message: result.duplicate && (result.status === 'paid' || result.status === 'exempt')
          ? 'La cuota de ese periodo ya estaba pagada o exenta; no se genero una nueva renovacion.'
          : result.duplicate
            ? 'La cuota de ese periodo ya existia y quedo lista para cobrar.'
            : 'La cuota del periodo elegido quedo lista para cobrar.',
      });
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos generar la cuota.' });
    }
  };

  return (
    <div className={embedded ? 'accounting-embedded-panel' : 'accounting-shell'}>
      {!embedded && (
        <section className="floating-card accounting-hero">
          <div className="accounting-hero__copy">
            <h1>Cuenta de socio</h1>
          </div>
        </section>
      )}
      {embedded && (
        <section className="floating-card accounting-panel">
          <div className="accounting-section-header">
            <div>
              <p className="eyebrow">Cuotas societarias</p>
              <h2>Cuenta de socio</h2>
              <p>Consulta deuda consolidada y conceptos abiertos vinculados al socio.</p>
            </div>
          </div>
        </section>
      )}

      <AccountingInlineNotice notice={notice} />
      <AccountingInlineNotice notice={collections.error ? { kind: 'error', message: collections.error } : null} />

      <div className="accounting-collections-grid">
        <MemberSearchPanel
          members={collections.members}
          selectedMemberId={collections.memberId}
          onSelectMember={collections.setMemberId}
          loading={collections.loading}
        />

        <div className="accounting-collections-main">
          <MemberAccountSnapshot member={collections.selectedMember} openItems={collections.openItems} />

          {collections.selectedMember && !isMemberBlocked && (
            <section className="floating-card accounting-panel">
              <div className="accounting-section-header">
                <div>
                  <p className="eyebrow">Cuota</p>
                  <h2>Preparar cuota de un mes</h2>
                  <p>Selecciona el mes que quieras cobrar, incluso si todavia no comenzo.</p>
                </div>
                <div className="accounting-inline-actions">
                  <AccountingMonthPicker
                    label="Mes de la cuota"
                    period={collections.period}
                    maxPeriod={MAX_FUTURE_MEMBER_FEE_PERIOD}
                    onChange={collections.setPeriod}
                  />
                  <UiActionButton type="button" onClick={() => void handleGeneratedFee()}>
                    Preparar cuota
                  </UiActionButton>
                </div>
              </div>
            </section>
          )}

          {collections.selectedMember && !isMemberBlocked && collections.openItems.length > 0 && (
            <PaymentComposer
              memberId={collections.selectedMember.id}
              openItems={collections.openItems}
              paymentMethods={paymentMethods}
              autoSelectOpenItems={autoSelectOpenItems}
              onSubmitManual={(nextReceipt) => {
                setReceipt(nextReceipt);
                setNotice({ kind: 'success', message: 'Cobro registrado. Se actualiza deuda y recibo.' });
                void collections.reloadOpenItems();
                void reload();
              }}
            />
          )}
        </div>

        <ReceiptDrawer receipt={receipt} />
      </div>

      {showManualIncomeForm && (
        <ManualIncomeForm
          incomeCategories={incomeCategories}
          paymentMethods={summary?.paymentMethods ?? []}
          onNotice={setNotice}
          onRegistered={() => void reload()}
        />
      )}
    </div>
  );
}
