import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { EntityWithId, MercadoPagoCheckoutSessionDocument } from '../modules/accounting/domain/models';
import { createAccountingCallables } from '../modules/accounting/functions/accounting.callables';

const accountingCallables = createAccountingCallables();

function formatCurrency(amountMinor: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

function getReturnTitle(result: string | undefined): string {
  if (result === 'success') {
    return 'Pago enviado a Mercado Pago';
  }
  if (result === 'pending') {
    return 'Pago pendiente de acreditación';
  }
  if (result === 'failure') {
    return 'Pago no completado';
  }
  return 'Estado de Mercado Pago';
}

export function MercadoPagoReturn() {
  const { result } = useParams();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('sessionId') ?? searchParams.get('external_reference') ?? '';
  const paymentId = searchParams.get('payment_id') ?? searchParams.get('paymentId') ?? '';
  const externalReference = searchParams.get('external_reference') ?? '';
  const [session, setSession] = useState<EntityWithId<MercadoPagoCheckoutSessionDocument> | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(Boolean(sessionId));

  const title = useMemo(() => getReturnTitle(result), [result]);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      if (!sessionId) {
        setLoading(false);
        setError('Mercado Pago no devolvió una sesión válida para consultar.');
        return;
      }

      try {
        const response = await accountingCallables.getMercadoPagoCheckoutStatus({ sessionId });
        if (!cancelled) {
          setSession(response.session);
          setMessage(response.message);
        }
      } catch (statusError) {
        if (!cancelled) {
          setError(statusError instanceof Error ? statusError.message : 'No pudimos consultar el estado del pago.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const handleCopyCheckoutUrl = async () => {
    if (!session?.checkoutUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(session.checkoutUrl);
      setCopied(true);
    } catch {
      setError('No pudimos copiar el link. Abrilo con el boton de checkout o copialo desde el navegador.');
    }
  };

  return (
    <div className="page-shell accounting-page">
      <section className="floating-card accounting-primary-panel">
        <div className="accounting-section-header">
          <div>
            <p className="eyebrow">Mercado Pago</p>
            <h1>{title}</h1>
            <p>
              La pantalla de retorno es informativa. La acreditación definitiva se registra cuando el webhook confirma
              el pago con Mercado Pago.
            </p>
          </div>
          <div className="accounting-inline-actions">
            <Link className="btn-secondary" to="/mi-membresia">
              Ver membresía
            </Link>
            <Link className="btn-primary" to="/accounting/caja?tab=cobros&mode=mercadopago">
              Ir a contabilidad
            </Link>
          </div>
        </div>

        {loading && <div className="empty-state empty-state--inline">Consultando estado del checkout...</div>}

        {error && <div className="error-message">{error}</div>}

        {session && (
          <div className="accounting-action-card accounting-action-card--embedded">
            <div>
              <strong>{message || 'Estado actualizado.'}</strong>
              <p>
                Sesión {session.id} · Estado {session.status}
              </p>
              {(paymentId || externalReference) && (
                <p className="profile-note">
                  Retorno recibido con paymentId {paymentId || 'sin dato'} y referencia {externalReference || 'sin dato'}.
                  Este dato no postea recibo: solo informa hasta que la base confirme.
                </p>
              )}
            </div>

            <div className="accounting-list">
              {session.items.map((item) => (
                <article key={`${item.sourceType}-${item.sourceId ?? item.description}`} className="accounting-row">
                  <div className="accounting-row__main">
                    <strong>{item.description}</strong>
                    <small>{item.sourceType.replaceAll('_', ' ')}</small>
                  </div>
                  <div className="accounting-row__meta">
                    <strong>{formatCurrency(item.amountMinor)}</strong>
                  </div>
                </article>
              ))}
            </div>

            <div className="accounting-inline-summary">
              <span>Total</span>
              <strong>{formatCurrency(session.grossAmountMinor)}</strong>
            </div>

            {(session.status === 'pending' || result === 'pending') && (
              <div className="profile-note">
                Pago pendiente de acreditacion / verificacion. No se muestra recibo hasta que exista confirmacion interna.
              </div>
            )}

            {session.status === 'approved' && session.financialMovementIds.length > 0 && (
              <div className="accounting-action-card accounting-action-card--embedded">
                <div>
                  <strong>Pago confirmado internamente</strong>
                  <p>Movimientos contables: {session.financialMovementIds.join(', ')}</p>
                </div>
                <Link className="btn-primary" to={`/accounting/caja?tab=cobros&receipt=${session.financialMovementIds[0]}`}>
                  Ver recibo
                </Link>
              </div>
            )}

            {session.status === 'ready' && session.checkoutUrl && (
              <div className="accounting-action-card accounting-action-card--embedded">
                <div>
                  <strong>Checkout listo para abrir</strong>
                  <p>
                    El cliente paga entrando al checkout seguro de Mercado Pago. Si el cobro es presencial, tambien
                    podes copiar el link y enviarselo.
                  </p>
                </div>
                <div className="accounting-inline-actions">
                  <a className="btn-primary" href={session.checkoutUrl}>
                    Abrir checkout de Mercado Pago
                  </a>
                  <button type="button" className="btn-secondary" onClick={handleCopyCheckoutUrl}>
                    {copied ? 'Link copiado' : 'Copiar link'}
                  </button>
                </div>
              </div>
            )}

            {session.status === 'ready' && !session.checkoutUrl && (
              <div className="profile-note">
                La sesion esta lista, pero no tiene link de checkout guardado. Reintentá crear el cobro desde
                contabilidad.
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
