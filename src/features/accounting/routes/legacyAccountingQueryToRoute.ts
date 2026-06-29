const PRESERVED_QUERY_PARAMS = ['memberId', 'employeeId', 'period', 'tab', 'mode'] as const;

export function legacyAccountingQueryToRoute(search: string | URLSearchParams): string {
  const params = typeof search === 'string' ? new URLSearchParams(search) : new URLSearchParams(search);
  const section = params.get('section');
  const subsection = params.get('subsection');
  let pathname = '/accounting/overview';

  if (section === 'cuotas' && subsection === 'register-payment') {
    pathname = '/accounting/caja';
    params.set('tab', 'cobros');
  } else if (section === 'cuotas' && subsection === 'generate-fee') {
    pathname = '/accounting/member-dues';
  } else if (section === 'cuotas' && subsection === 'renewals') {
    pathname = '/accounting/member-dues';
    params.set('tab', params.get('tab') ?? 'renewals');
  } else if (section === 'cuotas' && subsection === 'membership-pricing') {
    pathname = '/accounting/member-dues';
    params.set('tab', params.get('tab') ?? 'config');
  } else if (section === 'movimientos' && subsection === 'expense-form') {
    pathname = '/accounting/caja';
    params.set('tab', 'egresos');
  } else if (section === 'cuotas' && subsection === 'expense-form') {
    pathname = '/accounting/caja';
    params.set('tab', 'egresos');
  } else if (section === 'movimientos' && subsection === 'expense-queue') {
    pathname = '/accounting/caja';
    params.set('tab', 'rendiciones');
  } else if (section === 'empleados' && (subsection === 'employee-expenses' || subsection === 'expense-queue')) {
    pathname = '/accounting/caja';
    params.set('tab', 'rendiciones');
  } else if (section === 'movimientos' && subsection === 'mercado-pago') {
    pathname = '/accounting/caja';
    params.set('tab', 'cobros');
    params.set('mode', 'mercadopago');
  } else if (section === 'cuotas' && subsection === 'mercado-pago') {
    pathname = '/accounting/caja';
    params.set('tab', 'cobros');
    params.set('mode', 'mercadopago');
  } else if (section === 'empleados' && subsection === 'employee-list') {
    pathname = '/accounting/employees';
  } else if (section === 'sensibles' && subsection === 'reference') {
    pathname = '/accounting/external-docs';
  } else if (subsection === 'payment-methods' || subsection === 'medios-pago') {
    pathname = '/accounting/payment-methods';
  } else if (section === 'sensibles' && subsection === 'salary') {
    pathname = '/accounting/employees';
    params.set('focus', 'salary');
  } else if (
    (section === 'sensibles' && subsection === 'sensitive-settlements')
    || (section === 'tesoreria' && subsection === 'treasury-settlements')
    || (section === 'tesoreria' && subsection === 'treasury-summary')
  ) {
    pathname = '/accounting/bank-settlements';
  } else if (section === 'reportes') {
    pathname = '/accounting/reports';
  }

  const nextParams = new URLSearchParams();
  PRESERVED_QUERY_PARAMS.forEach((key) => {
    const value = params.get(key);
    if (value) {
      nextParams.set(key, value);
    }
  });

  const nextSearch = nextParams.toString();
  return nextSearch ? `${pathname}?${nextSearch}` : pathname;
}
