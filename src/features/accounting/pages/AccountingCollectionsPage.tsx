import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UiActionButton } from '../../../components/UiActionButton';
import { ACCOUNTING_PAYMENT_METHOD_IDS } from '../../../modules/accounting/domain/constants';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { MemberAccountSnapshot } from '../components/MemberAccountSnapshot';
import { MemberSearchPanel } from '../components/MemberSearchPanel';
import { PaymentComposer } from '../components/PaymentComposer';
import { ReceiptDrawer } from '../components/ReceiptDrawer';
import { useAccountingSummary } from '../hooks/useAccountingSummary';
import { useMemberCollections } from '../hooks/useMemberCollections';
import type { AccountingNotice } from '../types/accounting';
import type { CheckoutSession, ManualPaymentReceipt, PaymentComposerMode } from '../types/payment';
import { normalizeAccountingPeriod } from '../utils/accountingFormatters';

export function AccountingCollectionsPage() {
  const [searchParams] = useSearchParams();
  const modeParam = searchParams.get('mode');
  const memberIdParam = searchParams.get('memberId');
  const initialMode: PaymentComposerMode = modeParam === 'mercadopago' ? 'mercadopago' : 'manual';
  const collections = useMemberCollections(
    memberIdParam,
    searchParams.get('period') ? normalizeAccountingPeriod(searchParams.get('period')) : undefined,
  );
  const { summary, reload } = useAccountingSummary();
  const [mode, setMode] = useState<PaymentComposerMode>(initialMode);
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [receipt, setReceipt] = useState<ManualPaymentReceipt | null>(null);
  const [checkout, setCheckout] = useState<CheckoutSession | null>(null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const paymentMethods = useMemo(() => {
    if (!summary?.paymentMethods.length) {
      return [];
    }

    return mode === 'mercadopago'
      ? summary.paymentMethods.filter((method) => method.id === ACCOUNTING_PAYMENT_METHOD_IDS.mercadoPago)
      : summary.paymentMethods;
  }, [mode, summary?.paymentMethods]);

  const isMemberBlocked = collections.selectedMember?.status === 'inactive' || collections.selectedMember?.status === 'suspended';

  const handleGeneratedFee = async () => {
    setNotice(null);
    try {
      const result = await collections.generateFeeAndReload();
      setNotice({
        kind: 'success',
        message: result.duplicate
          ? `La cuota ya existia y se reutilizo ${result.memberFeeChargeId}.`
          : `Cuota ${result.memberFeeChargeId} generada. Ya podes continuar con el cobro.`,
      });
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos generar la cuota.' });
    }
  };

  return (
    <div className="accounting-shell">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <p className="eyebrow">Cobros</p>
          <h1>Workspace de caja societaria</h1>
          <p>Busca socio, confirma deuda, emiti cuota si falta, elegi medio de pago y revisa antes de postear.</p>
        </div>
        <div className="accounting-hero__actions">
          <UiActionButton type="button" variant={mode === 'manual' ? 'positive' : 'secondary'} onClick={() => setMode('manual')}>
            Manual
          </UiActionButton>
          <UiActionButton type="button" variant={mode === 'mercadopago' ? 'positive' : 'secondary'} onClick={() => setMode('mercadopago')}>
            Mercado Pago
          </UiActionButton>
        </div>
      </section>

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

          {collections.selectedMember && !isMemberBlocked && collections.openItems.length === 0 && (
            <section className="floating-card accounting-panel">
              <div className="accounting-section-header">
                <div>
                  <p className="eyebrow">Cuota</p>
                  <h2>No hay cuota abierta</h2>
                  <p>Si corresponde renovar, genera la cuota y continua en esta misma pantalla.</p>
                </div>
                <UiActionButton type="button" onClick={() => void handleGeneratedFee()}>
                  Generar cuota y continuar
                </UiActionButton>
              </div>
            </section>
          )}

          {collections.selectedMember && !isMemberBlocked && collections.openItems.length > 0 && (
            <PaymentComposer
              memberId={collections.selectedMember.id}
              openItems={collections.openItems}
              paymentMethods={paymentMethods}
              mode={mode}
              onSubmitManual={(nextReceipt) => {
                setReceipt(nextReceipt);
                setCheckout(null);
                setNotice({ kind: 'success', message: 'Cobro registrado. Se actualiza deuda y recibo.' });
                void collections.reloadOpenItems();
                void reload();
              }}
              onCreateCheckout={(nextCheckout) => {
                setCheckout(nextCheckout);
                setReceipt(null);
                setNotice({ kind: 'success', message: 'Checkout creado. El recibo aparece cuando el webhook confirme el pago.' });
              }}
            />
          )}
        </div>

        <ReceiptDrawer receipt={receipt} checkout={checkout} />
      </div>
    </div>
  );
}
