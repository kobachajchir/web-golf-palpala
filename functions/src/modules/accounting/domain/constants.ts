import type {
  AdvertisingDefaultPeriodicity,
  FinancialConfigDocument,
  FinancialExpenseCategoryDocument,
  FinancialIncomeCategoryDocument,
  PaymentMethodDocument,
} from './models.js';

export const ACCOUNTING_COLLECTIONS = {
  financialConfigs: 'financial_configs',
  paymentMethods: 'payment_methods',
  paymentCommissionRules: 'payment_commission_rules',
  financialIncomeCategories: 'financial_income_categories',
  financialExpenseCategories: 'financial_expense_categories',
  financialMovements: 'financial_movements',
  macroDebitSettlements: 'macro_debit_settlements',
  salaryConfigurations: 'salary_configurations',
  salaryPayments: 'salary_payments',
  payrollConfigs: 'payroll_configs',
  externalAccountingReferences: 'external_accounting_references',
  employeeAccountingLinks: 'employee_accounting_links',
  employeeCertificates: 'employee_certificates',
  employeePayrollCycles: 'employee_payroll_cycles',
  expenseSubmissions: 'expense_submissions',
  overtimeEntries: 'overtime_entries',
  cashClosures: 'cash_closures',
  concessionContracts: 'concession_contracts',
  advertisingContracts: 'advertising_contracts',
  handicapCharges: 'handicap_charges',
  memberFeeCharges: 'member_fee_charges',
} as const;

export const SYSTEM_ACTOR_UID = 'system';
export const DEFAULT_CURRENCY = 'ARS' as const;
export const MAX_BPS = 10_000;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const ACCOUNTING_TIME_ZONE = 'America/Argentina/Buenos_Aires';
export const ACCOUNTING_TIME_ZONE_OFFSET = '-03:00';
export const MEMBERSHIP_RENEWAL_TERM_DAYS = 30;
export const DEFAULT_EARLY_PAYMENT_DISCOUNT_PCT_BPS = 1_000;
export const DEFAULT_EARLY_PAYMENT_DISCOUNT_DAY_OF_MONTH = 10;
export const DEFAULT_MEMBER_GREEN_FEE_WEEKDAY_MINOR = 1_000_000;
export const DEFAULT_MEMBER_GREEN_FEE_SATURDAY_HOLIDAY_MINOR = 2_000_000;
export const DEFAULT_GUEST_GREEN_FEE_WEEKDAY_MINOR = 1_000_000;
export const DEFAULT_GUEST_GREEN_FEE_SATURDAY_HOLIDAY_MINOR = 2_000_000;
export const DEFAULT_MINOR_GREEN_FEE_SATURDAY_HOLIDAY_PCT_BPS = 5_000;

export const PAYMENT_METHOD_IDS = {
  debitMacro: 'debit_macro',
  transferMacro: 'transfer_macro',
  qrMacro: 'qr_macro',
  transferGalicia: 'transfer_galicia',
  qrGalicia: 'qr_galicia',
  debitGalicia: 'debit_galicia',
  creditGalicia: 'credit_galicia',
  debit: 'debit',
  transfer: 'transfer',
  credit: 'credit',
  cash: 'cash',
} as const;

export const FINANCIAL_INCOME_CATEGORY_IDS = {
  cuotaSocietaria: 'cuota_societaria',
  greenFee: 'green_fee',
  tournamentRegistration: 'tournament_registration',
  rentalTennis: 'rental_tennis',
  rentalPadel: 'rental_padel',
  rentalGym: 'rental_gym',
  concessionCantinero: 'concession_cantinero',
  concessionMonthly: 'concession_monthly',
  advertisingBoard: 'advertising_board',
  advertisingAntenna: 'advertising_antenna',
  handicap: 'handicap',
  rentalHall: 'rental_hall',
  rentalGreenSpace: 'rental_green_space',
  internalTransfer: 'transferencia_interna_ingreso',
} as const;

export const FINANCIAL_EXPENSE_CATEGORY_IDS = {
  sueldo: 'sueldo',
  aguinaldo: 'aguinaldo',
  f931: 'f931',
  obraSocial: 'obra_social',
  art: 'art',
  horasExtra: 'horas_extra',
  proveedores: 'proveedores',
  insumosAgropecuarios: 'insumos_agropecuarios',
  combustible: 'combustible',
  lubricantes: 'lubricantes',
  luz: 'luz',
  agua: 'agua',
  bancarios: 'bancarios',
  mantenimiento: 'mantenimiento',
  limpieza: 'limpieza',
  insumos: 'insumos',
  servidor: 'servidor',
  varios: 'varios',
  internalTransfer: 'transferencia_interna_egreso',
} as const;

export const DEFAULT_PAYMENT_METHODS: Array<{ id: string; data: Omit<PaymentMethodDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'> }> = [
  {
    id: PAYMENT_METHOD_IDS.debitMacro,
    data: {
      name: 'Cuenta debito Macro',
      bancarizado: true,
      specialReportingType: 'macro_debit',
      active: true,
      sortOrder: 10,
    },
  },
  {
    id: PAYMENT_METHOD_IDS.transfer,
    data: {
      name: 'Transferencia',
      bancarizado: true,
      specialReportingType: null,
      active: true,
      sortOrder: 20,
    },
  },
  {
    id: PAYMENT_METHOD_IDS.credit,
    data: {
      name: 'Crédito',
      bancarizado: true,
      specialReportingType: null,
      active: true,
      sortOrder: 30,
    },
  },
  {
    id: PAYMENT_METHOD_IDS.debit,
    data: {
      name: 'Débito',
      bancarizado: true,
      specialReportingType: null,
      active: true,
      sortOrder: 35,
    },
  },
  {
    id: PAYMENT_METHOD_IDS.cash,
    data: {
      name: 'Efectivo',
      bancarizado: false,
      specialReportingType: null,
      active: true,
      sortOrder: 40,
    },
  },
] as const;

export const CLIENT_PAYMENT_METHODS: Array<{ id: string; data: Omit<PaymentMethodDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'> }> = [
  {
    id: PAYMENT_METHOD_IDS.cash,
    data: { name: 'Efectivo', bancarizado: false, specialReportingType: null, active: true, sortOrder: 10 },
  },
  {
    id: PAYMENT_METHOD_IDS.transferMacro,
    data: { name: 'Transferencia Macro', bancarizado: true, specialReportingType: null, active: true, sortOrder: 20 },
  },
  {
    id: PAYMENT_METHOD_IDS.qrMacro,
    data: { name: 'QR Macro', bancarizado: true, specialReportingType: null, active: true, sortOrder: 30 },
  },
  {
    id: PAYMENT_METHOD_IDS.debitMacro,
    data: { name: 'Cuenta debito Macro', bancarizado: true, specialReportingType: 'macro_debit', active: true, sortOrder: 35 },
  },
  {
    id: PAYMENT_METHOD_IDS.transferGalicia,
    data: { name: 'Transferencia Galicia', bancarizado: true, specialReportingType: null, active: true, sortOrder: 40 },
  },
  {
    id: PAYMENT_METHOD_IDS.qrGalicia,
    data: { name: 'QR Galicia', bancarizado: true, specialReportingType: null, active: true, sortOrder: 50 },
  },
  {
    id: PAYMENT_METHOD_IDS.debitGalicia,
    data: { name: 'Tarjeta de debito', bancarizado: true, specialReportingType: null, active: true, sortOrder: 60 },
  },
  {
    id: PAYMENT_METHOD_IDS.creditGalicia,
    data: { name: 'Tarjeta de credito', bancarizado: true, specialReportingType: null, active: true, sortOrder: 70 },
  },
] as const;

export const DEPRECATED_PAYMENT_METHOD_IDS = [
  'mercado_pago',
  PAYMENT_METHOD_IDS.transfer,
  PAYMENT_METHOD_IDS.debit,
  PAYMENT_METHOD_IDS.credit,
] as const;

export const DEFAULT_FINANCIAL_INCOME_CATEGORIES: Array<{
  id: string;
  data: Omit<FinancialIncomeCategoryDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>;
}> = [
  { id: FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria, data: { name: 'Cuota societaria', description: 'Cobro mensual de socios.', originType: 'member_fee_charge', active: true, sortOrder: 10 } },
  { id: FINANCIAL_INCOME_CATEGORY_IDS.greenFee, data: { name: 'Green fee', description: 'Ingreso por green fee.', originType: 'green_fee', active: true, sortOrder: 20 } },
  { id: FINANCIAL_INCOME_CATEGORY_IDS.tournamentRegistration, data: { name: 'Inscripción torneo', description: 'Registro de torneos.', originType: 'tournament_registration', active: true, sortOrder: 30 } },
  { id: FINANCIAL_INCOME_CATEGORY_IDS.rentalTennis, data: { name: 'Alquiler tenis', description: 'Alquiler de cancha de tenis.', originType: 'rental_tennis', active: true, sortOrder: 40 } },
  { id: FINANCIAL_INCOME_CATEGORY_IDS.rentalPadel, data: { name: 'Alquiler pádel', description: 'Alquiler de cancha de pádel.', originType: 'rental_padel', active: true, sortOrder: 50 } },
  { id: FINANCIAL_INCOME_CATEGORY_IDS.rentalGym, data: { name: 'Alquiler gimnasio', description: 'Alquiler de gimnasio.', originType: 'rental_gym', active: true, sortOrder: 60 } },
  { id: FINANCIAL_INCOME_CATEGORY_IDS.concessionCantinero, data: { name: 'Concesión cantinero', description: 'Cobro de concesión cantinero.', originType: 'concession_contract', active: true, sortOrder: 70 } },
  { id: FINANCIAL_INCOME_CATEGORY_IDS.concessionMonthly, data: { name: 'Concesión mensual', description: 'Cobro de concesiones mensuales.', originType: 'concession_contract', active: true, sortOrder: 80 } },
  { id: FINANCIAL_INCOME_CATEGORY_IDS.advertisingBoard, data: { name: 'Publicidad cartelería', description: 'Publicidad en carteles.', originType: 'advertising_contract', active: true, sortOrder: 90 } },
  { id: FINANCIAL_INCOME_CATEGORY_IDS.advertisingAntenna, data: { name: 'Publicidad antena', description: 'Publicidad por antena.', originType: 'advertising_contract', active: true, sortOrder: 100 } },
  { id: FINANCIAL_INCOME_CATEGORY_IDS.handicap, data: { name: 'Handicap', description: 'Cobro de handicap.', originType: 'handicap', active: true, sortOrder: 110 } },
  { id: FINANCIAL_INCOME_CATEGORY_IDS.rentalHall, data: { name: 'Alquiler salón', description: 'Alquiler esporádico de salón.', originType: 'rental_hall', active: true, sortOrder: 120 } },
  { id: FINANCIAL_INCOME_CATEGORY_IDS.rentalGreenSpace, data: { name: 'Alquiler espacio verde', description: 'Alquiler de espacio verde.', originType: 'rental_green_space', active: true, sortOrder: 130 } },
  { id: FINANCIAL_INCOME_CATEGORY_IDS.internalTransfer, data: { name: 'Transferencia interna recibida', description: 'Ingreso por movimiento interno entre cuentas.', originType: 'internal_transfer', active: true, sortOrder: 140 } },
] as const;

export const DEFAULT_FINANCIAL_EXPENSE_CATEGORIES: Array<{
  id: string;
  data: Omit<FinancialExpenseCategoryDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>;
}> = [
  { id: FINANCIAL_EXPENSE_CATEGORY_IDS.sueldo, data: { name: 'Sueldo', description: 'Pago de salarios.', defaultBancarizado: true, defaultImputableImpositivo: true, active: true, sortOrder: 10 } },
  { id: FINANCIAL_EXPENSE_CATEGORY_IDS.aguinaldo, data: { name: 'Aguinaldo', description: 'Pago de sueldo anual complementario.', defaultBancarizado: true, defaultImputableImpositivo: true, active: true, sortOrder: 15 } },
  { id: FINANCIAL_EXPENSE_CATEGORY_IDS.f931, data: { name: 'F931', description: 'Referencia y pago F931.', defaultBancarizado: true, defaultImputableImpositivo: true, active: true, sortOrder: 20 } },
  { id: FINANCIAL_EXPENSE_CATEGORY_IDS.obraSocial, data: { name: 'Obra social', description: 'Pago de obra social.', defaultBancarizado: true, defaultImputableImpositivo: true, active: true, sortOrder: 30 } },
  { id: FINANCIAL_EXPENSE_CATEGORY_IDS.art, data: { name: 'ART', description: 'Pago de ART.', defaultBancarizado: true, defaultImputableImpositivo: true, active: true, sortOrder: 40 } },
  { id: FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra, data: { name: 'Horas extra', description: 'Pago de horas extra.', defaultBancarizado: false, defaultImputableImpositivo: false, active: true, sortOrder: 50 } },
  { id: FINANCIAL_EXPENSE_CATEGORY_IDS.proveedores, data: { name: 'Proveedores', description: 'Pago a proveedores.', defaultBancarizado: true, defaultImputableImpositivo: true, active: true, sortOrder: 60 } },
  { id: FINANCIAL_EXPENSE_CATEGORY_IDS.insumosAgropecuarios, data: { name: 'Insumos agropecuarios', description: 'Compras agropecuarias.', defaultBancarizado: true, defaultImputableImpositivo: true, active: true, sortOrder: 70 } },
  { id: FINANCIAL_EXPENSE_CATEGORY_IDS.combustible, data: { name: 'Combustible', description: 'Combustible y cargas.', defaultBancarizado: false, defaultImputableImpositivo: true, active: true, sortOrder: 80 } },
  { id: FINANCIAL_EXPENSE_CATEGORY_IDS.lubricantes, data: { name: 'Lubricantes', description: 'Lubricantes y fluidos.', defaultBancarizado: true, defaultImputableImpositivo: true, active: true, sortOrder: 90 } },
  { id: FINANCIAL_EXPENSE_CATEGORY_IDS.luz, data: { name: 'Luz', description: 'Servicios eléctricos.', defaultBancarizado: true, defaultImputableImpositivo: true, active: true, sortOrder: 100 } },
  { id: FINANCIAL_EXPENSE_CATEGORY_IDS.agua, data: { name: 'Agua', description: 'Servicios de agua.', defaultBancarizado: true, defaultImputableImpositivo: true, active: true, sortOrder: 110 } },
  { id: FINANCIAL_EXPENSE_CATEGORY_IDS.bancarios, data: { name: 'Bancarios', description: 'Gastos bancarios.', defaultBancarizado: true, defaultImputableImpositivo: true, active: true, sortOrder: 120 } },
  { id: FINANCIAL_EXPENSE_CATEGORY_IDS.mantenimiento, data: { name: 'Mantenimiento', description: 'Mantenimiento general.', defaultBancarizado: true, defaultImputableImpositivo: true, active: true, sortOrder: 130 } },
  { id: FINANCIAL_EXPENSE_CATEGORY_IDS.limpieza, data: { name: 'Limpieza', description: 'Insumos y servicios de limpieza.', defaultBancarizado: true, defaultImputableImpositivo: true, active: true, sortOrder: 140 } },
  { id: FINANCIAL_EXPENSE_CATEGORY_IDS.insumos, data: { name: 'Insumos', description: 'Insumos varios.', defaultBancarizado: true, defaultImputableImpositivo: true, active: true, sortOrder: 150 } },
  { id: FINANCIAL_EXPENSE_CATEGORY_IDS.servidor, data: { name: 'SERVIDOR', description: 'Gasto fijo mensual de servidor.', defaultBancarizado: true, defaultImputableImpositivo: true, active: true, sortOrder: 160 } },
  { id: FINANCIAL_EXPENSE_CATEGORY_IDS.varios, data: { name: 'Varios', description: 'Otros egresos no comprendidos en las categorias anteriores.', defaultBancarizado: false, defaultImputableImpositivo: true, active: true, sortOrder: 170 } },
  { id: FINANCIAL_EXPENSE_CATEGORY_IDS.internalTransfer, data: { name: 'Transferencia interna enviada', description: 'Egreso por movimiento interno entre cuentas.', defaultBancarizado: true, defaultImputableImpositivo: false, active: true, sortOrder: 180 } },
] as const;

export const DEFAULT_FINANCIAL_CONFIG: Omit<FinancialConfigDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'effectiveFrom' | 'effectiveTo'> = {
  version: 1,
  isActive: true,
  currency: 'ARS',
  fullMemberFeeMinor: 11_000_000,
  familyAssociatePctBps: 5_000,
  lifetimePctBps: 5_000,
  minorPctBps: 3_000,
  licensePctBps: 0,
  maxLicenseMonths: 6,
  creditCommissionPctBps: 300,
  earlyPaymentDiscountPctBps: DEFAULT_EARLY_PAYMENT_DISCOUNT_PCT_BPS,
  earlyPaymentDiscountDayOfMonth: DEFAULT_EARLY_PAYMENT_DISCOUNT_DAY_OF_MONTH,
  familyGroupBillingMode: 'per_member',
  allowStandaloneMinor: true,
  membershipChargePersistenceMode: 'member_fee_charges',
  greenFeeAppliesToMembers: true,
  memberGreenFeeWeekdayMinor: DEFAULT_MEMBER_GREEN_FEE_WEEKDAY_MINOR,
  memberGreenFeeSaturdayHolidayMinor: DEFAULT_MEMBER_GREEN_FEE_SATURDAY_HOLIDAY_MINOR,
  guestGreenFeeWeekdayMinor: DEFAULT_GUEST_GREEN_FEE_WEEKDAY_MINOR,
  guestGreenFeeSaturdayHolidayMinor: DEFAULT_GUEST_GREEN_FEE_SATURDAY_HOLIDAY_MINOR,
  minorGreenFeeSaturdayHolidayPctBps: DEFAULT_MINOR_GREEN_FEE_SATURDAY_HOLIDAY_PCT_BPS,
  nationalHolidayDates: [],
  cantineroContractMode: 'fixed_monthly',
  advertisingDefaultPeriodicity: 'monthly' satisfies AdvertisingDefaultPeriodicity,
  requireApprovalForExpensePosting: true,
  requireApprovalForOvertimePosting: true,
  serverMonthlyExpenseMinor: 6500,
  serverMonthlyExpenseDueDay: 20,
  notes: 'Configuración inicial ACCOUNTING.',
};
