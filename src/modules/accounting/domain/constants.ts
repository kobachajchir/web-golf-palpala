export const ACCOUNTING_CALLABLE_NAMES = {
  upsertFinancialConfig: 'accountingUpsertFinancialConfig',
  upsertSalaryConfiguration: 'accountingUpsertSalaryConfiguration',
  generateCuota: 'accountingGenerateCuota',
  registerPayment: 'accountingRegisterPayment',
  submitExpense: 'accountingSubmitExpense',
  reviewExpense: 'accountingReviewExpense',
  postExpenseMovement: 'accountingPostExpenseMovement',
  recordExternalReference: 'accountingRecordExternalReference',
  reconcileMacroSettlement: 'accountingReconcileMacroSettlement',
  voidFinancialMovement: 'accountingVoidFinancialMovement',
} as const;

export const ACCOUNTING_COLLECTIONS = {
  financialConfigs: 'financial_configs',
  paymentMethods: 'payment_methods',
  financialMovements: 'financial_movements',
  macroDebitSettlements: 'macro_debit_settlements',
  expenseSubmissions: 'expense_submissions',
  salaryPayments: 'salary_payments',
  externalAccountingReferences: 'external_accounting_references',
  handicapCharges: 'handicap_charges',
  memberFeeCharges: 'member_fee_charges',
} as const;

export const ACCOUNTING_PAYMENT_METHOD_IDS = {
  debitMacro: 'debit_macro',
  debit: 'debit',
  transfer: 'transfer',
  credit: 'credit',
  cash: 'cash',
} as const;

export const ACCOUNTING_INCOME_CATEGORY_IDS = {
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
} as const;

export const ACCOUNTING_EXPENSE_CATEGORY_IDS = {
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
} as const;

export const ACCOUNTING_REFERENCE_TYPES = ['F931', 'OBRA_SOCIAL', 'ART', 'OTHER'] as const;
