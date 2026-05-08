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
    externalAccountingReferences: 'external_accounting_references',
    expenseSubmissions: 'expense_submissions',
    concessionContracts: 'concession_contracts',
    advertisingContracts: 'advertising_contracts',
    handicapCharges: 'handicap_charges',
    memberFeeCharges: 'member_fee_charges',
};
export const SYSTEM_ACTOR_UID = 'system';
export const DEFAULT_CURRENCY = 'ARS';
export const MAX_BPS = 10_000;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const ACCOUNTING_TIME_ZONE = 'America/Argentina/Buenos_Aires';
export const ACCOUNTING_TIME_ZONE_OFFSET = '-03:00';
export const MEMBERSHIP_RENEWAL_TERM_DAYS = 30;
export const DEFAULT_EARLY_PAYMENT_DISCOUNT_PCT_BPS = 1_000;
export const DEFAULT_EARLY_PAYMENT_DISCOUNT_DAY_OF_MONTH = 10;
export const PAYMENT_METHOD_IDS = {
    debitMacro: 'debit_macro',
    debit: 'debit',
    transfer: 'transfer',
    credit: 'credit',
    cash: 'cash',
};
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
};
export const FINANCIAL_EXPENSE_CATEGORY_IDS = {
    sueldo: 'sueldo',
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
};
export const DEFAULT_PAYMENT_METHODS = [
    {
        id: PAYMENT_METHOD_IDS.debitMacro,
        data: {
            name: 'Débito Macro',
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
];
export const DEFAULT_FINANCIAL_INCOME_CATEGORIES = [
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
];
export const DEFAULT_FINANCIAL_EXPENSE_CATEGORIES = [
    { id: FINANCIAL_EXPENSE_CATEGORY_IDS.sueldo, data: { name: 'Sueldo', description: 'Pago de salarios.', defaultBancarizado: true, defaultImputableImpositivo: true, active: true, sortOrder: 10 } },
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
];
export const DEFAULT_FINANCIAL_CONFIG = {
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
    cantineroContractMode: 'fixed_monthly',
    advertisingDefaultPeriodicity: 'monthly',
    requireApprovalForExpensePosting: true,
    requireApprovalForOvertimePosting: true,
    notes: 'Configuración inicial ACCOUNTING.',
};
//# sourceMappingURL=constants.js.map