import { Timestamp } from 'firebase-admin/firestore';
import type {
  Actor,
  AdvertisingContractDocument,
  CashClosureDocument,
  ConcessionContractDocument,
  EmployeeAccountingLinkDocument,
  EmployeeCertificateDocument,
  EmployeePayrollCycleDocument,
  EntityWithId,
  ExpenseSubmissionDocument,
  ExternalAccountingReferenceDocument,
  FinancialConfigDocument,
  FinancialExpenseCategoryDocument,
  FinancialIncomeCategoryDocument,
  FinancialMovementDocument,
  HandicapChargeDocument,
  MacroDebitSettlementDocument,
  MemberFeeChargeDocument,
  MercadoPagoCheckoutSessionDocument,
  MercadoPagoEventDocument,
  OvertimeEntryDocument,
  PayrollConfigDocument,
  PaymentCommissionRuleDocument,
  PaymentMethodDocument,
  ReferencedEmployeeDocument,
  ReferencedFamilyGroupDocument,
  ReferencedHandicapDocument,
  ReferencedMemberDocument,
  ReferencedUserDocument,
  SalaryConfigurationDocument,
  SalaryPaymentDocument,
} from '../../src/modules/accounting/domain/models.js';
import type { TournamentRegistrationDocument } from '../../src/modules/tournaments/domain/models.js';
import type {
  AccountingDataAccess,
  AccountingTransactionManager,
  AdvertisingContractsStore,
  CashClosureFilters,
  CashClosuresStore,
  ConcessionContractsStore,
  CursorPage,
  EmployeeAccountingLinkFilters,
  EmployeeAccountingLinksStore,
  EmployeeCertificateFilters,
  EmployeeCertificatesStore,
  EmployeePayrollCycleFilters,
  EmployeePayrollCyclesStore,
  EmployeesReferenceStore,
  ExpenseSubmissionsStore,
  ExternalAccountingReferencesStore,
  FamilyGroupsReferenceStore,
  FinancialConfigsStore,
  FinancialExpenseCategoriesStore,
  FinancialIncomeCategoriesStore,
  FinancialMovementFilters,
  FinancialMovementsStore,
  HandicapChargeFilters,
  HandicapChargesStore,
  HandicapsReferenceStore,
  MacroDebitSettlementFilters,
  MacroDebitSettlementsStore,
  MemberFeeChargeFilters,
  MemberFeeChargesStore,
  MemberReferenceFilters,
  MembersReferenceStore,
  MercadoPagoCheckoutSessionFilters,
  MercadoPagoCheckoutSessionsStore,
  MercadoPagoEventsStore,
  OvertimeEntriesStore,
  OvertimeEntryFilters,
  PayrollConfigsStore,
  PaymentCommissionRulesStore,
  PaymentMethodsStore,
  SalaryConfigurationsStore,
  SalaryPaymentsFilters,
  SalaryPaymentsStore,
  StorePatch,
  TournamentRegistrationsReferenceStore,
  UsersReferenceStore,
} from '../../src/modules/accounting/domain/ports.js';

function timestampNow(): Timestamp {
  return Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z'));
}

function createAudit(actorUid = 'system') {
  const now = timestampNow();
  return {
    createdAt: now,
    createdBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid,
  };
}

function applyPatch<T extends object>(entity: T, patch: StorePatch<T>): T {
  const next = { ...entity } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch) as Array<[keyof T, T[keyof T] | null | undefined]>) {
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      delete next[key as string];
      continue;
    }
    next[key as string] = value;
  }
  return next as T;
}

function pageFromItems<T extends { id: string }>(
  items: T[],
  limit?: number,
  cursorId?: string,
): CursorPage<T> {
  const normalizedLimit = limit ?? 25;
  const startIndex = cursorId ? Math.max(items.findIndex((item) => item.id === cursorId) + 1, 0) : 0;
  const pageItems = items.slice(startIndex, startIndex + normalizedLimit);
  const nextCursorId = pageItems.length === normalizedLimit ? pageItems.at(-1)?.id : undefined;
  return {
    items: pageItems,
    ...(nextCursorId ? { nextCursorId } : {}),
  };
}

class InMemoryUsersReferenceStore implements UsersReferenceStore {
  public constructor(private readonly items: Map<string, EntityWithId<ReferencedUserDocument>>) {}

  public async getById(uid: string): Promise<EntityWithId<ReferencedUserDocument> | null> {
    return this.items.get(uid) ?? null;
  }
}

class InMemoryMembersReferenceStore implements MembersReferenceStore {
  public constructor(private readonly items: Map<string, EntityWithId<ReferencedMemberDocument>>) {}

  public async getById(memberId: string): Promise<EntityWithId<ReferencedMemberDocument> | null> {
    return this.items.get(memberId) ?? null;
  }

  public async update(memberId: string, patch: StorePatch<ReferencedMemberDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(memberId);
    if (!existing) {
      return;
    }
    this.items.set(memberId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }

  public async listPage(filters: MemberReferenceFilters): Promise<CursorPage<EntityWithId<ReferencedMemberDocument>>> {
    let items = Array.from(this.items.values());
    if (filters.status) {
      items = items.filter((item) => item.status === filters.status);
    }
    items.sort((left, right) => left.id.localeCompare(right.id));
    return pageFromItems(items, filters.limit, filters.cursorId);
  }
}

class InMemoryFamilyGroupsReferenceStore implements FamilyGroupsReferenceStore {
  public constructor(private readonly items: Map<string, EntityWithId<ReferencedFamilyGroupDocument>>) {}

  public async getById(groupId: string): Promise<EntityWithId<ReferencedFamilyGroupDocument> | null> {
    return this.items.get(groupId) ?? null;
  }
}

class InMemoryEmployeesReferenceStore implements EmployeesReferenceStore {
  public constructor(private readonly items: Map<string, EntityWithId<ReferencedEmployeeDocument>>) {}

  public async getById(employeeId: string): Promise<EntityWithId<ReferencedEmployeeDocument> | null> {
    return this.items.get(employeeId) ?? null;
  }
}

class InMemoryHandicapsReferenceStore implements HandicapsReferenceStore {
  public constructor(private readonly items: Map<string, EntityWithId<ReferencedHandicapDocument>>) {}

  public async getById(handicapId: string): Promise<EntityWithId<ReferencedHandicapDocument> | null> {
    return this.items.get(handicapId) ?? null;
  }
}

class InMemoryTournamentRegistrationsReferenceStore implements TournamentRegistrationsReferenceStore {
  public constructor(private readonly items: Map<string, EntityWithId<TournamentRegistrationDocument>>) {}

  public async getById(registrationId: string): Promise<EntityWithId<TournamentRegistrationDocument> | null> {
    return this.items.get(registrationId) ?? null;
  }

  public async update(registrationId: string, patch: StorePatch<TournamentRegistrationDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(registrationId);
    if (!existing) {
      return;
    }
    this.items.set(registrationId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }
}

class InMemoryFinancialConfigsStore implements FinancialConfigsStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<FinancialConfigDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(configId: string): Promise<EntityWithId<FinancialConfigDocument> | null> {
    return this.items.get(configId) ?? null;
  }

  public async getActive(): Promise<EntityWithId<FinancialConfigDocument> | null> {
    return Array.from(this.items.values()).find((item) => item.isActive) ?? null;
  }

  public async getLatestVersion(): Promise<EntityWithId<FinancialConfigDocument> | null> {
    return Array.from(this.items.values()).sort((a, b) => b.version - a.version)[0] ?? null;
  }

  public async create(
    data: Omit<FinancialConfigDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, { id, ...data, ...createAudit(actorUid) });
    return id;
  }

  public async update(configId: string, patch: StorePatch<FinancialConfigDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(configId);
    if (!existing) {
      return;
    }
    this.items.set(configId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }
}

class InMemoryPaymentMethodsStore implements PaymentMethodsStore {
  public constructor(private readonly items: Map<string, EntityWithId<PaymentMethodDocument>>) {}

  public async getById(paymentMethodId: string): Promise<EntityWithId<PaymentMethodDocument> | null> {
    return this.items.get(paymentMethodId) ?? null;
  }

  public async set(
    paymentMethodId: string,
    data: Omit<PaymentMethodDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<void> {
    this.items.set(paymentMethodId, {
      id: paymentMethodId,
      ...data,
      ...createAudit(actorUid),
    });
  }
}

class InMemoryPaymentCommissionRulesStore implements PaymentCommissionRulesStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<PaymentCommissionRuleDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(ruleId: string): Promise<EntityWithId<PaymentCommissionRuleDocument> | null> {
    return this.items.get(ruleId) ?? null;
  }

  public async getActiveByPaymentMethodId(paymentMethodId: string): Promise<EntityWithId<PaymentCommissionRuleDocument> | null> {
    return Array.from(this.items.values())
      .filter((item) => item.paymentMethodId === paymentMethodId && item.isActive)
      .sort((a, b) => b.validFrom.toMillis() - a.validFrom.toMillis())[0] ?? null;
  }

  public async create(
    data: Omit<PaymentCommissionRuleDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, { id, ...data, ...createAudit(actorUid) });
    return id;
  }

  public async update(ruleId: string, patch: StorePatch<PaymentCommissionRuleDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(ruleId);
    if (!existing) {
      return;
    }
    this.items.set(ruleId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }
}

class InMemoryFinancialIncomeCategoriesStore implements FinancialIncomeCategoriesStore {
  public constructor(private readonly items: Map<string, EntityWithId<FinancialIncomeCategoryDocument>>) {}

  public async getById(categoryId: string): Promise<EntityWithId<FinancialIncomeCategoryDocument> | null> {
    return this.items.get(categoryId) ?? null;
  }

  public async set(
    categoryId: string,
    data: Omit<FinancialIncomeCategoryDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<void> {
    this.items.set(categoryId, {
      id: categoryId,
      ...data,
      ...createAudit(actorUid),
    });
  }
}

class InMemoryFinancialExpenseCategoriesStore implements FinancialExpenseCategoriesStore {
  public constructor(private readonly items: Map<string, EntityWithId<FinancialExpenseCategoryDocument>>) {}

  public async getById(categoryId: string): Promise<EntityWithId<FinancialExpenseCategoryDocument> | null> {
    return this.items.get(categoryId) ?? null;
  }

  public async set(
    categoryId: string,
    data: Omit<FinancialExpenseCategoryDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<void> {
    this.items.set(categoryId, {
      id: categoryId,
      ...data,
      ...createAudit(actorUid),
    });
  }
}

class InMemoryFinancialMovementsStore implements FinancialMovementsStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<FinancialMovementDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(movementId: string): Promise<EntityWithId<FinancialMovementDocument> | null> {
    return this.items.get(movementId) ?? null;
  }

  public async create(
    data: Omit<FinancialMovementDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, { id, ...data, ...createAudit(actorUid) });
    return id;
  }

  public async update(movementId: string, patch: StorePatch<FinancialMovementDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(movementId);
    if (!existing) {
      return;
    }
    this.items.set(movementId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }

  public async listPage(filters: FinancialMovementFilters): Promise<CursorPage<EntityWithId<FinancialMovementDocument>>> {
    let items = Array.from(this.items.values());
    if (filters.movementType) {
      items = items.filter((item) => item.movementType === filters.movementType);
    }
    if (filters.categoryCodeSnapshot) {
      items = items.filter((item) => item.categoryCodeSnapshot === filters.categoryCodeSnapshot);
    }
    if (filters.paymentMethodCodeSnapshot) {
      items = items.filter((item) => item.paymentMethodCodeSnapshot === filters.paymentMethodCodeSnapshot);
    }
    if (filters.thirdPartyType) {
      items = items.filter((item) => item.thirdPartyType === filters.thirdPartyType);
    }
    if (filters.thirdPartyId) {
      items = items.filter((item) => item.thirdPartyId === filters.thirdPartyId);
    }
    if (filters.accountingPeriod) {
      items = items.filter((item) => item.accountingPeriod === filters.accountingPeriod);
    }
    if (filters.status) {
      items = items.filter((item) => item.status === filters.status);
    }
    if (filters.settlementId) {
      items = items.filter((item) => item.settlementId === filters.settlementId);
    }
    if (filters.bancarizado !== undefined) {
      items = items.filter((item) => item.bancarizado === filters.bancarizado);
    }
    if (filters.imputableImpositivo !== undefined) {
      items = items.filter((item) => item.imputableImpositivo === filters.imputableImpositivo);
    }
    items.sort((a, b) => b.operationDate.toMillis() - a.operationDate.toMillis());
    return pageFromItems(items, filters.limit, filters.cursorId);
  }

  public async listBySettlementId(settlementId: string): Promise<Array<EntityWithId<FinancialMovementDocument>>> {
    return Array.from(this.items.values())
      .filter((item) => item.settlementId === settlementId)
      .sort((a, b) => a.operationDate.toMillis() - b.operationDate.toMillis());
  }
}

class InMemoryMacroDebitSettlementsStore implements MacroDebitSettlementsStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<MacroDebitSettlementDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(settlementId: string): Promise<EntityWithId<MacroDebitSettlementDocument> | null> {
    return this.items.get(settlementId) ?? null;
  }

  public async getByExternalBatchRef(externalBatchRef: string): Promise<EntityWithId<MacroDebitSettlementDocument> | null> {
    return Array.from(this.items.values()).find((item) => item.externalBatchRef === externalBatchRef) ?? null;
  }

  public async create(
    data: Omit<MacroDebitSettlementDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, { id, ...data, ...createAudit(actorUid) });
    return id;
  }

  public async update(settlementId: string, patch: StorePatch<MacroDebitSettlementDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(settlementId);
    if (!existing) {
      return;
    }
    this.items.set(settlementId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }

  public async listPage(filters: MacroDebitSettlementFilters): Promise<CursorPage<EntityWithId<MacroDebitSettlementDocument>>> {
    let items = Array.from(this.items.values());
    if (filters.month) {
      items = items.filter((item) => item.month === filters.month);
    }
    if (filters.status) {
      items = items.filter((item) => item.status === filters.status);
    }
    items.sort((a, b) => b.month.localeCompare(a.month));
    return pageFromItems(items, filters.limit, filters.cursorId);
  }
}

class InMemorySalaryConfigurationsStore implements SalaryConfigurationsStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<SalaryConfigurationDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(configurationId: string): Promise<EntityWithId<SalaryConfigurationDocument> | null> {
    return this.items.get(configurationId) ?? null;
  }

  public async getActiveByEmployeeId(employeeId: string): Promise<EntityWithId<SalaryConfigurationDocument> | null> {
    return Array.from(this.items.values())
      .filter((item) => item.employeeId === employeeId && item.isActive)
      .sort((a, b) => b.effectiveFrom.toMillis() - a.effectiveFrom.toMillis())[0] ?? null;
  }

  public async create(
    data: Omit<SalaryConfigurationDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, { id, ...data, ...createAudit(actorUid) });
    return id;
  }

  public async update(configurationId: string, patch: StorePatch<SalaryConfigurationDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(configurationId);
    if (!existing) {
      return;
    }
    this.items.set(configurationId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }
}

class InMemorySalaryPaymentsStore implements SalaryPaymentsStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<SalaryPaymentDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(paymentId: string): Promise<EntityWithId<SalaryPaymentDocument> | null> {
    return this.items.get(paymentId) ?? null;
  }

  public async findByEmployeeAndPeriod(employeeId: string, period: string): Promise<EntityWithId<SalaryPaymentDocument> | null> {
    return Array.from(this.items.values()).find((item) => item.employeeId === employeeId && item.period === period) ?? null;
  }

  public async create(
    data: Omit<SalaryPaymentDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, { id, ...data, ...createAudit(actorUid) });
    return id;
  }

  public async update(paymentId: string, patch: StorePatch<SalaryPaymentDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(paymentId);
    if (!existing) {
      return;
    }
    this.items.set(paymentId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }

  public async listPage(filters: SalaryPaymentsFilters): Promise<CursorPage<EntityWithId<SalaryPaymentDocument>>> {
    let items = Array.from(this.items.values());
    if (filters.employeeId) {
      items = items.filter((item) => item.employeeId === filters.employeeId);
    }
    if (filters.period) {
      items = items.filter((item) => item.period === filters.period);
    }
    if (filters.status) {
      items = items.filter((item) => item.status === filters.status);
    }
    items.sort((a, b) => b.period.localeCompare(a.period));
    return pageFromItems(items, filters.limit, filters.cursorId);
  }
}

class InMemoryPayrollConfigsStore implements PayrollConfigsStore {
  public constructor(private readonly items: Map<string, EntityWithId<PayrollConfigDocument>>) {}

  public async getCurrent(): Promise<EntityWithId<PayrollConfigDocument> | null> {
    return this.items.get('current') ?? null;
  }

  public async setCurrent(
    data: Omit<PayrollConfigDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<void> {
    const existing = this.items.get('current');
    this.items.set('current', {
      id: 'current',
      ...(existing ?? {}),
      ...data,
      createdAt: existing?.createdAt ?? timestampNow(),
      createdBy: existing?.createdBy ?? actorUid,
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }
}

class InMemoryOvertimeEntriesStore implements OvertimeEntriesStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<OvertimeEntryDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(overtimeEntryId: string): Promise<EntityWithId<OvertimeEntryDocument> | null> {
    return this.items.get(overtimeEntryId) ?? null;
  }

  public async create(
    data: Omit<OvertimeEntryDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, { id, ...data, ...createAudit(actorUid) });
    return id;
  }

  public async update(overtimeEntryId: string, patch: StorePatch<OvertimeEntryDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(overtimeEntryId);
    if (!existing) {
      return;
    }
    this.items.set(overtimeEntryId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }

  public async listApprovedByEmployeeAndPeriod(employeeId: string, period: string): Promise<Array<EntityWithId<OvertimeEntryDocument>>> {
    return Array.from(this.items.values())
      .filter((item) => item.employeeId === employeeId && item.period === period && item.status === 'approved')
      .sort((a, b) => a.workDate.toMillis() - b.workDate.toMillis());
  }

  public async listPage(filters: OvertimeEntryFilters): Promise<CursorPage<EntityWithId<OvertimeEntryDocument>>> {
    let items = Array.from(this.items.values());
    if (filters.employeeId) {
      items = items.filter((item) => item.employeeId === filters.employeeId);
    }
    if (filters.period) {
      items = items.filter((item) => item.period === filters.period);
    }
    if (filters.status) {
      items = items.filter((item) => item.status === filters.status);
    }
    items.sort((a, b) => b.workDate.toMillis() - a.workDate.toMillis());
    return pageFromItems(items, filters.limit, filters.cursorId);
  }
}

class InMemoryEmployeePayrollCyclesStore implements EmployeePayrollCyclesStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<EmployeePayrollCycleDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(cycleId: string): Promise<EntityWithId<EmployeePayrollCycleDocument> | null> {
    return this.items.get(cycleId) ?? null;
  }

  public async findByEmployeeAndPeriod(employeeId: string, period: string): Promise<EntityWithId<EmployeePayrollCycleDocument> | null> {
    return Array.from(this.items.values()).find((item) => item.employeeId === employeeId && item.period === period) ?? null;
  }

  public async create(
    data: Omit<EmployeePayrollCycleDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, { id, ...data, ...createAudit(actorUid) });
    return id;
  }

  public async update(cycleId: string, patch: StorePatch<EmployeePayrollCycleDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(cycleId);
    if (!existing) {
      return;
    }
    this.items.set(cycleId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }

  public async listPage(filters: EmployeePayrollCycleFilters): Promise<CursorPage<EntityWithId<EmployeePayrollCycleDocument>>> {
    let items = Array.from(this.items.values());
    if (filters.employeeId) {
      items = items.filter((item) => item.employeeId === filters.employeeId);
    }
    if (filters.period) {
      items = items.filter((item) => item.period === filters.period);
    }
    if (filters.status) {
      items = items.filter((item) => item.status === filters.status);
    }
    items.sort((a, b) => b.period.localeCompare(a.period));
    return pageFromItems(items, filters.limit, filters.cursorId);
  }
}

class InMemoryEmployeeAccountingLinksStore implements EmployeeAccountingLinksStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<EmployeeAccountingLinkDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(linkId: string): Promise<EntityWithId<EmployeeAccountingLinkDocument> | null> {
    return this.items.get(linkId) ?? null;
  }

  public async findDuplicate(params: {
    employeeId: string;
    period: string;
    referenceId: string;
  }): Promise<EntityWithId<EmployeeAccountingLinkDocument> | null> {
    return Array.from(this.items.values()).find((item) =>
      item.employeeId === params.employeeId && item.period === params.period && item.referenceId === params.referenceId,
    ) ?? null;
  }

  public async findByEmployeePeriodAndReferenceType(params: {
    employeeId: string;
    period: string;
    referenceType: EmployeeAccountingLinkDocument['referenceType'];
  }): Promise<EntityWithId<EmployeeAccountingLinkDocument> | null> {
    return Array.from(this.items.values()).find((item) =>
      item.employeeId === params.employeeId && item.period === params.period && item.referenceType === params.referenceType,
    ) ?? null;
  }

  public async create(
    data: Omit<EmployeeAccountingLinkDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, { id, ...data, ...createAudit(actorUid) });
    return id;
  }

  public async update(linkId: string, patch: StorePatch<EmployeeAccountingLinkDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(linkId);
    if (!existing) {
      return;
    }
    this.items.set(linkId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }

  public async listPage(filters: EmployeeAccountingLinkFilters): Promise<CursorPage<EntityWithId<EmployeeAccountingLinkDocument>>> {
    let items = Array.from(this.items.values());
    if (filters.employeeId) {
      items = items.filter((item) => item.employeeId === filters.employeeId);
    }
    if (filters.period) {
      items = items.filter((item) => item.period === filters.period);
    }
    if (filters.referenceId) {
      items = items.filter((item) => item.referenceId === filters.referenceId);
    }
    if (filters.referenceType) {
      items = items.filter((item) => item.referenceType === filters.referenceType);
    }
    items.sort((a, b) => b.period.localeCompare(a.period));
    return pageFromItems(items, filters.limit, filters.cursorId);
  }
}

class InMemoryEmployeeCertificatesStore implements EmployeeCertificatesStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<EmployeeCertificateDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(certificateId: string): Promise<EntityWithId<EmployeeCertificateDocument> | null> {
    return this.items.get(certificateId) ?? null;
  }

  public async create(
    data: Omit<EmployeeCertificateDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, { id, ...data, ...createAudit(actorUid) });
    return id;
  }

  public async update(certificateId: string, patch: StorePatch<EmployeeCertificateDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(certificateId);
    if (!existing) {
      return;
    }
    this.items.set(certificateId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }

  public async listPage(filters: EmployeeCertificateFilters): Promise<CursorPage<EntityWithId<EmployeeCertificateDocument>>> {
    let items = Array.from(this.items.values());
    if (filters.employeeId) {
      items = items.filter((item) => item.employeeId === filters.employeeId);
    }
    if (filters.period) {
      items = items.filter((item) => item.period === filters.period);
    }
    if (filters.certificateType) {
      items = items.filter((item) => item.certificateType === filters.certificateType);
    }
    if (filters.status) {
      items = items.filter((item) => item.status === filters.status);
    }
    items.sort((a, b) => b.period.localeCompare(a.period));
    return pageFromItems(items, filters.limit, filters.cursorId);
  }
}

class InMemoryCashClosuresStore implements CashClosuresStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<CashClosureDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(cashClosureId: string): Promise<EntityWithId<CashClosureDocument> | null> {
    return this.items.get(cashClosureId) ?? null;
  }

  public async create(
    data: Omit<CashClosureDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, { id, ...data, ...createAudit(actorUid) });
    return id;
  }

  public async update(cashClosureId: string, patch: StorePatch<CashClosureDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(cashClosureId);
    if (!existing) {
      return;
    }
    this.items.set(cashClosureId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }

  public async listPage(filters: CashClosureFilters): Promise<CursorPage<EntityWithId<CashClosureDocument>>> {
    let items = Array.from(this.items.values());
    if (filters.period) {
      items = items.filter((item) => item.period === filters.period);
    }
    if (filters.status) {
      items = items.filter((item) => item.status === filters.status);
    }
    items.sort((a, b) => b.closureDate.toMillis() - a.closureDate.toMillis());
    return pageFromItems(items, filters.limit, filters.cursorId);
  }
}

class InMemoryExternalAccountingReferencesStore implements ExternalAccountingReferencesStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<ExternalAccountingReferenceDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(referenceId: string): Promise<EntityWithId<ExternalAccountingReferenceDocument> | null> {
    return this.items.get(referenceId) ?? null;
  }

  public async findByEmployeePeriodAndReferenceType(params: {
    employeeId: string;
    period: string;
    referenceType: ExternalAccountingReferenceDocument['referenceType'];
  }): Promise<EntityWithId<ExternalAccountingReferenceDocument> | null> {
    return Array.from(this.items.values()).find((item) =>
      item.employeeId === params.employeeId && item.period === params.period && item.referenceType === params.referenceType,
    ) ?? null;
  }

  public async create(
    data: Omit<ExternalAccountingReferenceDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, { id, ...data, ...createAudit(actorUid) });
    return id;
  }

  public async update(referenceId: string, patch: StorePatch<ExternalAccountingReferenceDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(referenceId);
    if (!existing) {
      return;
    }
    this.items.set(referenceId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }
}

class InMemoryExpenseSubmissionsStore implements ExpenseSubmissionsStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<ExpenseSubmissionDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(expenseSubmissionId: string): Promise<EntityWithId<ExpenseSubmissionDocument> | null> {
    return this.items.get(expenseSubmissionId) ?? null;
  }

  public async create(
    data: Omit<ExpenseSubmissionDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, { id, ...data, ...createAudit(actorUid) });
    return id;
  }

  public async update(expenseSubmissionId: string, patch: StorePatch<ExpenseSubmissionDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(expenseSubmissionId);
    if (!existing) {
      return;
    }
    this.items.set(expenseSubmissionId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }

  public async listPage(filters: import('../../src/modules/accounting/domain/ports.js').ExpenseSubmissionFilters): Promise<CursorPage<EntityWithId<ExpenseSubmissionDocument>>> {
    let items = Array.from(this.items.values());
    if (filters.employeeId) {
      items = items.filter((item) => item.employeeId === filters.employeeId);
    }
    if (filters.status) {
      items = items.filter((item) => item.status === filters.status);
    }
    items.sort((a, b) => b.expenseDate.toMillis() - a.expenseDate.toMillis());
    return pageFromItems(items, filters.limit, filters.cursorId);
  }
}

class InMemoryConcessionContractsStore implements ConcessionContractsStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<ConcessionContractDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(contractId: string): Promise<EntityWithId<ConcessionContractDocument> | null> {
    return this.items.get(contractId) ?? null;
  }

  public async create(
    data: Omit<ConcessionContractDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, { id, ...data, ...createAudit(actorUid) });
    return id;
  }

  public async update(contractId: string, patch: StorePatch<ConcessionContractDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(contractId);
    if (!existing) {
      return;
    }
    this.items.set(contractId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }
}

class InMemoryAdvertisingContractsStore implements AdvertisingContractsStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<AdvertisingContractDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(contractId: string): Promise<EntityWithId<AdvertisingContractDocument> | null> {
    return this.items.get(contractId) ?? null;
  }

  public async create(
    data: Omit<AdvertisingContractDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, { id, ...data, ...createAudit(actorUid) });
    return id;
  }

  public async update(contractId: string, patch: StorePatch<AdvertisingContractDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(contractId);
    if (!existing) {
      return;
    }
    this.items.set(contractId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }
}

class InMemoryHandicapChargesStore implements HandicapChargesStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<HandicapChargeDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(handicapChargeId: string): Promise<EntityWithId<HandicapChargeDocument> | null> {
    return this.items.get(handicapChargeId) ?? null;
  }

  public async findByMemberAndPeriod(memberId: string, period: string): Promise<EntityWithId<HandicapChargeDocument> | null> {
    return Array.from(this.items.values()).find((item) => item.memberId === memberId && item.period === period) ?? null;
  }

  public async create(
    data: Omit<HandicapChargeDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, { id, ...data, ...createAudit(actorUid) });
    return id;
  }

  public async update(handicapChargeId: string, patch: StorePatch<HandicapChargeDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(handicapChargeId);
    if (!existing) {
      return;
    }
    this.items.set(handicapChargeId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }

  public async listPage(filters: HandicapChargeFilters): Promise<CursorPage<EntityWithId<HandicapChargeDocument>>> {
    let items = Array.from(this.items.values());
    if (filters.memberId) {
      items = items.filter((item) => item.memberId === filters.memberId);
    }
    if (filters.status) {
      items = items.filter((item) => item.status === filters.status);
    }
    items.sort((a, b) => b.period.localeCompare(a.period));
    return pageFromItems(items, filters.limit, filters.cursorId);
  }
}

class InMemoryMemberFeeChargesStore implements MemberFeeChargesStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<MemberFeeChargeDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(memberFeeChargeId: string): Promise<EntityWithId<MemberFeeChargeDocument> | null> {
    return this.items.get(memberFeeChargeId) ?? null;
  }

  public async findDuplicate(params: {
    memberId?: string | null;
    familyGroupId?: string | null;
    period: string;
    billingMode: MemberFeeChargeDocument['billingMode'];
  }): Promise<EntityWithId<MemberFeeChargeDocument> | null> {
    return Array.from(this.items.values()).find((item) =>
      item.period === params.period
      && item.billingMode === params.billingMode
      && (params.billingMode === 'single_group_charge'
        ? item.familyGroupId === (params.familyGroupId ?? null)
        : item.memberId === (params.memberId ?? null)),
    ) ?? null;
  }

  public async create(
    data: Omit<MemberFeeChargeDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, { id, ...data, ...createAudit(actorUid) });
    return id;
  }

  public async update(memberFeeChargeId: string, patch: StorePatch<MemberFeeChargeDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(memberFeeChargeId);
    if (!existing) {
      return;
    }
    this.items.set(memberFeeChargeId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }

  public async listPage(filters: MemberFeeChargeFilters): Promise<CursorPage<EntityWithId<MemberFeeChargeDocument>>> {
    let items = Array.from(this.items.values());
    if (filters.memberId) {
      items = items.filter((item) => item.memberId === filters.memberId);
    }
    if (filters.familyGroupId) {
      items = items.filter((item) => item.familyGroupId === filters.familyGroupId);
    }
    if (filters.period) {
      items = items.filter((item) => item.period === filters.period);
    }
    if (filters.status) {
      items = items.filter((item) => item.status === filters.status);
    }
    items.sort((a, b) => b.period.localeCompare(a.period));
    return pageFromItems(items, filters.limit, filters.cursorId);
  }
}

class InMemoryMercadoPagoCheckoutSessionsStore implements MercadoPagoCheckoutSessionsStore {
  public constructor(private readonly items: Map<string, EntityWithId<MercadoPagoCheckoutSessionDocument>>) {}

  public async getById(sessionId: string): Promise<EntityWithId<MercadoPagoCheckoutSessionDocument> | null> {
    return this.items.get(sessionId) ?? null;
  }

  public async getByExternalReference(externalReference: string): Promise<EntityWithId<MercadoPagoCheckoutSessionDocument> | null> {
    return Array.from(this.items.values()).find((item) => item.externalReference === externalReference) ?? null;
  }

  public async getByPaymentId(paymentId: string): Promise<EntityWithId<MercadoPagoCheckoutSessionDocument> | null> {
    return Array.from(this.items.values()).find((item) => item.paymentId === paymentId) ?? null;
  }

  public async set(
    sessionId: string,
    data: Omit<MercadoPagoCheckoutSessionDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<void> {
    this.items.set(sessionId, { id: sessionId, ...data, ...createAudit(actorUid) });
  }

  public async update(sessionId: string, patch: StorePatch<MercadoPagoCheckoutSessionDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(sessionId);
    if (!existing) {
      return;
    }
    this.items.set(sessionId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }

  public async listPage(filters: MercadoPagoCheckoutSessionFilters): Promise<CursorPage<EntityWithId<MercadoPagoCheckoutSessionDocument>>> {
    let items = Array.from(this.items.values());
    if (filters.status) {
      items = items.filter((item) => item.status === filters.status);
    }
    if (filters.createdByUid) {
      items = items.filter((item) => item.createdByUid === filters.createdByUid);
    }
    items.sort((left, right) => right.updatedAt.toDate().getTime() - left.updatedAt.toDate().getTime());
    return pageFromItems(items, filters.limit, filters.cursorId);
  }
}

class InMemoryMercadoPagoEventsStore implements MercadoPagoEventsStore {
  public constructor(private readonly items: Map<string, EntityWithId<MercadoPagoEventDocument>>) {}

  public async getById(eventId: string): Promise<EntityWithId<MercadoPagoEventDocument> | null> {
    return this.items.get(eventId) ?? null;
  }

  public async set(
    eventId: string,
    data: Omit<MercadoPagoEventDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<void> {
    this.items.set(eventId, { id: eventId, ...data, ...createAudit(actorUid) });
  }

  public async update(eventId: string, patch: StorePatch<MercadoPagoEventDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(eventId);
    if (!existing) {
      return;
    }
    this.items.set(eventId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedAt: timestampNow(),
      updatedBy: actorUid,
    });
  }
}

export class InMemoryAccountingTransactionManager implements AccountingTransactionManager {
  public readonly users = new Map<string, EntityWithId<ReferencedUserDocument>>();
  public readonly members = new Map<string, EntityWithId<ReferencedMemberDocument>>();
  public readonly familyGroups = new Map<string, EntityWithId<ReferencedFamilyGroupDocument>>();
  public readonly employees = new Map<string, EntityWithId<ReferencedEmployeeDocument>>();
  public readonly handicaps = new Map<string, EntityWithId<ReferencedHandicapDocument>>();
  public readonly tournamentRegistrations = new Map<string, EntityWithId<TournamentRegistrationDocument>>();
  public readonly financialConfigs = new Map<string, EntityWithId<FinancialConfigDocument>>();
  public readonly paymentMethods = new Map<string, EntityWithId<PaymentMethodDocument>>();
  public readonly paymentCommissionRules = new Map<string, EntityWithId<PaymentCommissionRuleDocument>>();
  public readonly financialIncomeCategories = new Map<string, EntityWithId<FinancialIncomeCategoryDocument>>();
  public readonly financialExpenseCategories = new Map<string, EntityWithId<FinancialExpenseCategoryDocument>>();
  public readonly financialMovements = new Map<string, EntityWithId<FinancialMovementDocument>>();
  public readonly macroDebitSettlements = new Map<string, EntityWithId<MacroDebitSettlementDocument>>();
  public readonly salaryConfigurations = new Map<string, EntityWithId<SalaryConfigurationDocument>>();
  public readonly salaryPayments = new Map<string, EntityWithId<SalaryPaymentDocument>>();
  public readonly payrollConfigs = new Map<string, EntityWithId<PayrollConfigDocument>>();
  public readonly overtimeEntries = new Map<string, EntityWithId<OvertimeEntryDocument>>();
  public readonly employeePayrollCycles = new Map<string, EntityWithId<EmployeePayrollCycleDocument>>();
  public readonly employeeAccountingLinks = new Map<string, EntityWithId<EmployeeAccountingLinkDocument>>();
  public readonly employeeCertificates = new Map<string, EntityWithId<EmployeeCertificateDocument>>();
  public readonly cashClosures = new Map<string, EntityWithId<CashClosureDocument>>();
  public readonly externalAccountingReferences = new Map<string, EntityWithId<ExternalAccountingReferenceDocument>>();
  public readonly expenseSubmissions = new Map<string, EntityWithId<ExpenseSubmissionDocument>>();
  public readonly concessionContracts = new Map<string, EntityWithId<ConcessionContractDocument>>();
  public readonly advertisingContracts = new Map<string, EntityWithId<AdvertisingContractDocument>>();
  public readonly handicapCharges = new Map<string, EntityWithId<HandicapChargeDocument>>();
  public readonly memberFeeCharges = new Map<string, EntityWithId<MemberFeeChargeDocument>>();
  public readonly mercadoPagoCheckoutSessions = new Map<string, EntityWithId<MercadoPagoCheckoutSessionDocument>>();
  public readonly mercadoPagoEvents = new Map<string, EntityWithId<MercadoPagoEventDocument>>();

  private counters = {
    financialConfig: 0,
    commissionRule: 0,
    movement: 0,
    settlement: 0,
    salaryConfiguration: 0,
    salaryPayment: 0,
    overtimeEntry: 0,
    employeePayrollCycle: 0,
    employeeAccountingLink: 0,
    employeeCertificate: 0,
    cashClosure: 0,
    externalReference: 0,
    expenseSubmission: 0,
    concessionContract: 0,
    advertisingContract: 0,
    handicapCharge: 0,
    memberFeeCharge: 0,
  };

  public readonly dataAccess: AccountingDataAccess = {
    users: new InMemoryUsersReferenceStore(this.users),
    members: new InMemoryMembersReferenceStore(this.members),
    familyGroups: new InMemoryFamilyGroupsReferenceStore(this.familyGroups),
    employees: new InMemoryEmployeesReferenceStore(this.employees),
    handicaps: new InMemoryHandicapsReferenceStore(this.handicaps),
    tournamentRegistrations: new InMemoryTournamentRegistrationsReferenceStore(this.tournamentRegistrations),
    financialConfigs: new InMemoryFinancialConfigsStore(this.financialConfigs, () => `financial-config-${++this.counters.financialConfig}`),
    paymentMethods: new InMemoryPaymentMethodsStore(this.paymentMethods),
    paymentCommissionRules: new InMemoryPaymentCommissionRulesStore(this.paymentCommissionRules, () => `commission-rule-${++this.counters.commissionRule}`),
    financialIncomeCategories: new InMemoryFinancialIncomeCategoriesStore(this.financialIncomeCategories),
    financialExpenseCategories: new InMemoryFinancialExpenseCategoriesStore(this.financialExpenseCategories),
    financialMovements: new InMemoryFinancialMovementsStore(this.financialMovements, () => `movement-${++this.counters.movement}`),
    macroDebitSettlements: new InMemoryMacroDebitSettlementsStore(this.macroDebitSettlements, () => `settlement-${++this.counters.settlement}`),
    salaryConfigurations: new InMemorySalaryConfigurationsStore(this.salaryConfigurations, () => `salary-configuration-${++this.counters.salaryConfiguration}`),
    salaryPayments: new InMemorySalaryPaymentsStore(this.salaryPayments, () => `salary-payment-${++this.counters.salaryPayment}`),
    payrollConfigs: new InMemoryPayrollConfigsStore(this.payrollConfigs),
    overtimeEntries: new InMemoryOvertimeEntriesStore(this.overtimeEntries, () => `overtime-entry-${++this.counters.overtimeEntry}`),
    employeePayrollCycles: new InMemoryEmployeePayrollCyclesStore(this.employeePayrollCycles, () => `employee-payroll-cycle-${++this.counters.employeePayrollCycle}`),
    employeeAccountingLinks: new InMemoryEmployeeAccountingLinksStore(this.employeeAccountingLinks, () => `employee-accounting-link-${++this.counters.employeeAccountingLink}`),
    employeeCertificates: new InMemoryEmployeeCertificatesStore(this.employeeCertificates, () => `employee-certificate-${++this.counters.employeeCertificate}`),
    cashClosures: new InMemoryCashClosuresStore(this.cashClosures, () => `cash-closure-${++this.counters.cashClosure}`),
    externalAccountingReferences: new InMemoryExternalAccountingReferencesStore(this.externalAccountingReferences, () => `external-reference-${++this.counters.externalReference}`),
    expenseSubmissions: new InMemoryExpenseSubmissionsStore(this.expenseSubmissions, () => `expense-submission-${++this.counters.expenseSubmission}`),
    concessionContracts: new InMemoryConcessionContractsStore(this.concessionContracts, () => `concession-contract-${++this.counters.concessionContract}`),
    advertisingContracts: new InMemoryAdvertisingContractsStore(this.advertisingContracts, () => `advertising-contract-${++this.counters.advertisingContract}`),
    handicapCharges: new InMemoryHandicapChargesStore(this.handicapCharges, () => `handicap-charge-${++this.counters.handicapCharge}`),
    memberFeeCharges: new InMemoryMemberFeeChargesStore(this.memberFeeCharges, () => `member-fee-charge-${++this.counters.memberFeeCharge}`),
    mercadoPagoCheckoutSessions: new InMemoryMercadoPagoCheckoutSessionsStore(this.mercadoPagoCheckoutSessions),
    mercadoPagoEvents: new InMemoryMercadoPagoEventsStore(this.mercadoPagoEvents),
  };

  public async runInTransaction<T>(handler: (dataAccess: AccountingDataAccess) => Promise<T>): Promise<T> {
    return handler(this.dataAccess);
  }

  public getDataAccess(): AccountingDataAccess {
    return this.dataAccess;
  }
}

export function createAccountingActor(
  uid: string,
  roleIds: string[],
  claims?: Partial<Actor['claims']>,
): Actor {
  const user: EntityWithId<ReferencedUserDocument> = {
    id: uid,
    email: `${uid}@club.test`,
    displayName: uid,
    primaryRoleId: roleIds[0] ?? 'socio',
    roleIds,
    profileType: 'none',
    active: true,
    claimsVersion: 1,
    ...createAudit(),
  };

  return {
    uid,
    user,
    claims: {
      comite_ejecutivo: roleIds.includes('comite_ejecutivo') || roleIds.includes('directivo'),
      directivo: roleIds.includes('comite_ejecutivo') || roleIds.includes('directivo'),
      administrativo: roleIds.includes('administrativo'),
      empleado: roleIds.includes('empleado'),
      comision_directiva: roleIds.includes('comision_directiva'),
      socio: roleIds.includes('socio'),
      claimsVersion: 1,
      ...claims,
    },
  };
}

export function seedAccountingUser(
  manager: InMemoryAccountingTransactionManager,
  uid: string,
  overrides?: Partial<ReferencedUserDocument>,
): EntityWithId<ReferencedUserDocument> {
  const user: EntityWithId<ReferencedUserDocument> = {
    id: uid,
    email: `${uid}@club.test`,
    displayName: uid,
    primaryRoleId: 'socio',
    roleIds: ['socio'],
    profileType: 'none',
    active: true,
    claimsVersion: 1,
    ...createAudit(),
    ...overrides,
  };
  manager.users.set(uid, user);
  return user;
}

export function seedAccountingMember(
  manager: InMemoryAccountingTransactionManager,
  memberId: string,
  overrides?: Partial<ReferencedMemberDocument>,
): EntityWithId<ReferencedMemberDocument> {
  const member: EntityWithId<ReferencedMemberDocument> = {
    id: memberId,
    memberNumber: memberId,
    firstName: 'Socio',
    lastName: 'Club',
    typeId: 'pleno',
    typeCodeSnapshot: 'pleno',
    status: 'active',
    isFamilyHolder: false,
    joinedAt: timestampNow(),
    ...createAudit(),
    ...overrides,
  };
  manager.members.set(memberId, member);
  return member;
}

export function seedAccountingFamilyGroup(
  manager: InMemoryAccountingTransactionManager,
  groupId: string,
  overrides?: Partial<ReferencedFamilyGroupDocument>,
): EntityWithId<ReferencedFamilyGroupDocument> {
  const familyGroup: EntityWithId<ReferencedFamilyGroupDocument> = {
    id: groupId,
    holderMemberId: 'member-holder',
    memberIds: ['member-holder', 'member-associated'],
    active: true,
    ...createAudit(),
    ...overrides,
  };
  manager.familyGroups.set(groupId, familyGroup);
  return familyGroup;
}

export function seedAccountingEmployee(
  manager: InMemoryAccountingTransactionManager,
  employeeId: string,
  overrides?: Partial<ReferencedEmployeeDocument>,
): EntityWithId<ReferencedEmployeeDocument> {
  const employee: EntityWithId<ReferencedEmployeeDocument> = {
    id: employeeId,
    firstName: 'Empleado',
    lastName: 'Club',
    position: 'Recepción',
    contractType: 'monthly',
    status: 'active',
    startDate: timestampNow(),
    canSubmitExpenses: true,
    ...createAudit(),
    ...overrides,
  };
  manager.employees.set(employeeId, employee);
  return employee;
}

export function seedAccountingHandicap(
  manager: InMemoryAccountingTransactionManager,
  handicapId: string,
  overrides?: Partial<ReferencedHandicapDocument>,
): EntityWithId<ReferencedHandicapDocument> {
  const handicap: EntityWithId<ReferencedHandicapDocument> = {
    id: handicapId,
    memberId: 'member-1',
    handicapNumber: 18,
    validFrom: timestampNow(),
    status: 'active',
    issuedByUid: 'staff-1',
    ...createAudit(),
    ...overrides,
  };
  manager.handicaps.set(handicapId, handicap);
  return handicap;
}

export function seedActiveFinancialConfig(
  manager: InMemoryAccountingTransactionManager,
  configId = 'financial-config-active',
  overrides?: Partial<FinancialConfigDocument>,
): EntityWithId<FinancialConfigDocument> {
  const config: EntityWithId<FinancialConfigDocument> = {
    id: configId,
    version: 1,
    isActive: true,
    effectiveFrom: timestampNow(),
    currency: 'ARS',
    fullMemberFeeMinor: 11_000_000,
    familyAssociatePctBps: 5_000,
    lifetimePctBps: 5_000,
    minorPctBps: 3_000,
    licensePctBps: 0,
    maxLicenseMonths: 6,
    creditCommissionPctBps: 300,
    earlyPaymentDiscountPctBps: 1_000,
    earlyPaymentDiscountDayOfMonth: 10,
    familyGroupBillingMode: 'per_member',
    allowStandaloneMinor: true,
    membershipChargePersistenceMode: 'member_fee_charges',
    greenFeeAppliesToMembers: true,
    cantineroContractMode: 'fixed_monthly',
    advertisingDefaultPeriodicity: 'monthly',
    requireApprovalForExpensePosting: true,
    requireApprovalForOvertimePosting: true,
    serverMonthlyExpenseMinor: 0,
    ...createAudit(),
    ...overrides,
  };
  manager.financialConfigs.set(configId, config);
  return config;
}

export function seedPaymentMethod(
  manager: InMemoryAccountingTransactionManager,
  paymentMethodId: string,
  overrides?: Partial<PaymentMethodDocument>,
): EntityWithId<PaymentMethodDocument> {
  const method: EntityWithId<PaymentMethodDocument> = {
    id: paymentMethodId,
    name: paymentMethodId,
    bancarizado: paymentMethodId !== 'cash',
    specialReportingType: paymentMethodId === 'debit_macro' ? 'macro_debit' : null,
    active: true,
    sortOrder: 1,
    ...createAudit(),
    ...overrides,
  };
  manager.paymentMethods.set(paymentMethodId, method);
  return method;
}

export function seedCommissionRule(
  manager: InMemoryAccountingTransactionManager,
  ruleId: string,
  overrides?: Partial<PaymentCommissionRuleDocument>,
): EntityWithId<PaymentCommissionRuleDocument> {
  const rule: EntityWithId<PaymentCommissionRuleDocument> = {
    id: ruleId,
    paymentMethodId: 'credit',
    percentageBps: 300,
    isActive: true,
    validFrom: timestampNow(),
    setByUid: 'directivo-1',
    ...createAudit(),
    ...overrides,
  };
  manager.paymentCommissionRules.set(ruleId, rule);
  return rule;
}

export function seedIncomeCategory(
  manager: InMemoryAccountingTransactionManager,
  categoryId: string,
  overrides?: Partial<FinancialIncomeCategoryDocument>,
): EntityWithId<FinancialIncomeCategoryDocument> {
  const category: EntityWithId<FinancialIncomeCategoryDocument> = {
    id: categoryId,
    name: categoryId,
    originType: categoryId,
    active: true,
    sortOrder: 1,
    ...createAudit(),
    ...overrides,
  };
  manager.financialIncomeCategories.set(categoryId, category);
  return category;
}

export function seedExpenseCategory(
  manager: InMemoryAccountingTransactionManager,
  categoryId: string,
  overrides?: Partial<FinancialExpenseCategoryDocument>,
): EntityWithId<FinancialExpenseCategoryDocument> {
  const category: EntityWithId<FinancialExpenseCategoryDocument> = {
    id: categoryId,
    name: categoryId,
    defaultBancarizado: true,
    defaultImputableImpositivo: true,
    active: true,
    sortOrder: 1,
    ...createAudit(),
    ...overrides,
  };
  manager.financialExpenseCategories.set(categoryId, category);
  return category;
}
