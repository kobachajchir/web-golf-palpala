import { Timestamp } from 'firebase-admin/firestore';
function timestampNow() {
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
function applyPatch(entity, patch) {
    const next = { ...entity };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) {
            continue;
        }
        if (value === null) {
            delete next[key];
            continue;
        }
        next[key] = value;
    }
    return next;
}
function pageFromItems(items, limit, cursorId) {
    const normalizedLimit = limit ?? 25;
    const startIndex = cursorId ? Math.max(items.findIndex((item) => item.id === cursorId) + 1, 0) : 0;
    const pageItems = items.slice(startIndex, startIndex + normalizedLimit);
    const nextCursorId = pageItems.length === normalizedLimit ? pageItems.at(-1)?.id : undefined;
    return {
        items: pageItems,
        ...(nextCursorId ? { nextCursorId } : {}),
    };
}
class InMemoryUsersReferenceStore {
    items;
    constructor(items) {
        this.items = items;
    }
    async getById(uid) {
        return this.items.get(uid) ?? null;
    }
}
class InMemoryMembersReferenceStore {
    items;
    constructor(items) {
        this.items = items;
    }
    async getById(memberId) {
        return this.items.get(memberId) ?? null;
    }
    async update(memberId, patch, actorUid) {
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
}
class InMemoryFamilyGroupsReferenceStore {
    items;
    constructor(items) {
        this.items = items;
    }
    async getById(groupId) {
        return this.items.get(groupId) ?? null;
    }
}
class InMemoryEmployeesReferenceStore {
    items;
    constructor(items) {
        this.items = items;
    }
    async getById(employeeId) {
        return this.items.get(employeeId) ?? null;
    }
}
class InMemoryHandicapsReferenceStore {
    items;
    constructor(items) {
        this.items = items;
    }
    async getById(handicapId) {
        return this.items.get(handicapId) ?? null;
    }
}
class InMemoryFinancialConfigsStore {
    items;
    nextId;
    constructor(items, nextId) {
        this.items = items;
        this.nextId = nextId;
    }
    async getById(configId) {
        return this.items.get(configId) ?? null;
    }
    async getActive() {
        return Array.from(this.items.values()).find((item) => item.isActive) ?? null;
    }
    async getLatestVersion() {
        return Array.from(this.items.values()).sort((a, b) => b.version - a.version)[0] ?? null;
    }
    async create(data, actorUid) {
        const id = this.nextId();
        this.items.set(id, { id, ...data, ...createAudit(actorUid) });
        return id;
    }
    async update(configId, patch, actorUid) {
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
class InMemoryPaymentMethodsStore {
    items;
    constructor(items) {
        this.items = items;
    }
    async getById(paymentMethodId) {
        return this.items.get(paymentMethodId) ?? null;
    }
    async set(paymentMethodId, data, actorUid) {
        this.items.set(paymentMethodId, {
            id: paymentMethodId,
            ...data,
            ...createAudit(actorUid),
        });
    }
}
class InMemoryPaymentCommissionRulesStore {
    items;
    nextId;
    constructor(items, nextId) {
        this.items = items;
        this.nextId = nextId;
    }
    async getById(ruleId) {
        return this.items.get(ruleId) ?? null;
    }
    async getActiveByPaymentMethodId(paymentMethodId) {
        return Array.from(this.items.values())
            .filter((item) => item.paymentMethodId === paymentMethodId && item.isActive)
            .sort((a, b) => b.validFrom.toMillis() - a.validFrom.toMillis())[0] ?? null;
    }
    async create(data, actorUid) {
        const id = this.nextId();
        this.items.set(id, { id, ...data, ...createAudit(actorUid) });
        return id;
    }
    async update(ruleId, patch, actorUid) {
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
class InMemoryFinancialIncomeCategoriesStore {
    items;
    constructor(items) {
        this.items = items;
    }
    async getById(categoryId) {
        return this.items.get(categoryId) ?? null;
    }
    async set(categoryId, data, actorUid) {
        this.items.set(categoryId, {
            id: categoryId,
            ...data,
            ...createAudit(actorUid),
        });
    }
}
class InMemoryFinancialExpenseCategoriesStore {
    items;
    constructor(items) {
        this.items = items;
    }
    async getById(categoryId) {
        return this.items.get(categoryId) ?? null;
    }
    async set(categoryId, data, actorUid) {
        this.items.set(categoryId, {
            id: categoryId,
            ...data,
            ...createAudit(actorUid),
        });
    }
}
class InMemoryFinancialMovementsStore {
    items;
    nextId;
    constructor(items, nextId) {
        this.items = items;
        this.nextId = nextId;
    }
    async getById(movementId) {
        return this.items.get(movementId) ?? null;
    }
    async create(data, actorUid) {
        const id = this.nextId();
        this.items.set(id, { id, ...data, ...createAudit(actorUid) });
        return id;
    }
    async update(movementId, patch, actorUid) {
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
    async listPage(filters) {
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
    async listBySettlementId(settlementId) {
        return Array.from(this.items.values())
            .filter((item) => item.settlementId === settlementId)
            .sort((a, b) => a.operationDate.toMillis() - b.operationDate.toMillis());
    }
}
class InMemoryMacroDebitSettlementsStore {
    items;
    nextId;
    constructor(items, nextId) {
        this.items = items;
        this.nextId = nextId;
    }
    async getById(settlementId) {
        return this.items.get(settlementId) ?? null;
    }
    async getByExternalBatchRef(externalBatchRef) {
        return Array.from(this.items.values()).find((item) => item.externalBatchRef === externalBatchRef) ?? null;
    }
    async create(data, actorUid) {
        const id = this.nextId();
        this.items.set(id, { id, ...data, ...createAudit(actorUid) });
        return id;
    }
    async update(settlementId, patch, actorUid) {
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
    async listPage(filters) {
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
class InMemorySalaryConfigurationsStore {
    items;
    nextId;
    constructor(items, nextId) {
        this.items = items;
        this.nextId = nextId;
    }
    async getById(configurationId) {
        return this.items.get(configurationId) ?? null;
    }
    async getActiveByEmployeeId(employeeId) {
        return Array.from(this.items.values())
            .filter((item) => item.employeeId === employeeId && item.isActive)
            .sort((a, b) => b.effectiveFrom.toMillis() - a.effectiveFrom.toMillis())[0] ?? null;
    }
    async create(data, actorUid) {
        const id = this.nextId();
        this.items.set(id, { id, ...data, ...createAudit(actorUid) });
        return id;
    }
    async update(configurationId, patch, actorUid) {
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
class InMemorySalaryPaymentsStore {
    items;
    nextId;
    constructor(items, nextId) {
        this.items = items;
        this.nextId = nextId;
    }
    async getById(paymentId) {
        return this.items.get(paymentId) ?? null;
    }
    async findByEmployeeAndPeriod(employeeId, period) {
        return Array.from(this.items.values()).find((item) => item.employeeId === employeeId && item.period === period) ?? null;
    }
    async create(data, actorUid) {
        const id = this.nextId();
        this.items.set(id, { id, ...data, ...createAudit(actorUid) });
        return id;
    }
    async update(paymentId, patch, actorUid) {
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
    async listPage(filters) {
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
class InMemoryExternalAccountingReferencesStore {
    items;
    nextId;
    constructor(items, nextId) {
        this.items = items;
        this.nextId = nextId;
    }
    async getById(referenceId) {
        return this.items.get(referenceId) ?? null;
    }
    async create(data, actorUid) {
        const id = this.nextId();
        this.items.set(id, { id, ...data, ...createAudit(actorUid) });
        return id;
    }
    async update(referenceId, patch, actorUid) {
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
class InMemoryExpenseSubmissionsStore {
    items;
    nextId;
    constructor(items, nextId) {
        this.items = items;
        this.nextId = nextId;
    }
    async getById(expenseSubmissionId) {
        return this.items.get(expenseSubmissionId) ?? null;
    }
    async create(data, actorUid) {
        const id = this.nextId();
        this.items.set(id, { id, ...data, ...createAudit(actorUid) });
        return id;
    }
    async update(expenseSubmissionId, patch, actorUid) {
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
    async listPage(filters) {
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
class InMemoryConcessionContractsStore {
    items;
    nextId;
    constructor(items, nextId) {
        this.items = items;
        this.nextId = nextId;
    }
    async getById(contractId) {
        return this.items.get(contractId) ?? null;
    }
    async create(data, actorUid) {
        const id = this.nextId();
        this.items.set(id, { id, ...data, ...createAudit(actorUid) });
        return id;
    }
    async update(contractId, patch, actorUid) {
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
class InMemoryAdvertisingContractsStore {
    items;
    nextId;
    constructor(items, nextId) {
        this.items = items;
        this.nextId = nextId;
    }
    async getById(contractId) {
        return this.items.get(contractId) ?? null;
    }
    async create(data, actorUid) {
        const id = this.nextId();
        this.items.set(id, { id, ...data, ...createAudit(actorUid) });
        return id;
    }
    async update(contractId, patch, actorUid) {
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
class InMemoryHandicapChargesStore {
    items;
    nextId;
    constructor(items, nextId) {
        this.items = items;
        this.nextId = nextId;
    }
    async getById(handicapChargeId) {
        return this.items.get(handicapChargeId) ?? null;
    }
    async findByMemberAndPeriod(memberId, period) {
        return Array.from(this.items.values()).find((item) => item.memberId === memberId && item.period === period) ?? null;
    }
    async create(data, actorUid) {
        const id = this.nextId();
        this.items.set(id, { id, ...data, ...createAudit(actorUid) });
        return id;
    }
    async update(handicapChargeId, patch, actorUid) {
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
    async listPage(filters) {
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
class InMemoryMemberFeeChargesStore {
    items;
    nextId;
    constructor(items, nextId) {
        this.items = items;
        this.nextId = nextId;
    }
    async getById(memberFeeChargeId) {
        return this.items.get(memberFeeChargeId) ?? null;
    }
    async findDuplicate(params) {
        return Array.from(this.items.values()).find((item) => item.period === params.period
            && item.billingMode === params.billingMode
            && (params.billingMode === 'single_group_charge'
                ? item.familyGroupId === (params.familyGroupId ?? null)
                : item.memberId === (params.memberId ?? null))) ?? null;
    }
    async create(data, actorUid) {
        const id = this.nextId();
        this.items.set(id, { id, ...data, ...createAudit(actorUid) });
        return id;
    }
    async update(memberFeeChargeId, patch, actorUid) {
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
    async listPage(filters) {
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
export class InMemoryAccountingTransactionManager {
    users = new Map();
    members = new Map();
    familyGroups = new Map();
    employees = new Map();
    handicaps = new Map();
    financialConfigs = new Map();
    paymentMethods = new Map();
    paymentCommissionRules = new Map();
    financialIncomeCategories = new Map();
    financialExpenseCategories = new Map();
    financialMovements = new Map();
    macroDebitSettlements = new Map();
    salaryConfigurations = new Map();
    salaryPayments = new Map();
    externalAccountingReferences = new Map();
    expenseSubmissions = new Map();
    concessionContracts = new Map();
    advertisingContracts = new Map();
    handicapCharges = new Map();
    memberFeeCharges = new Map();
    counters = {
        financialConfig: 0,
        commissionRule: 0,
        movement: 0,
        settlement: 0,
        salaryConfiguration: 0,
        salaryPayment: 0,
        externalReference: 0,
        expenseSubmission: 0,
        concessionContract: 0,
        advertisingContract: 0,
        handicapCharge: 0,
        memberFeeCharge: 0,
    };
    dataAccess = {
        users: new InMemoryUsersReferenceStore(this.users),
        members: new InMemoryMembersReferenceStore(this.members),
        familyGroups: new InMemoryFamilyGroupsReferenceStore(this.familyGroups),
        employees: new InMemoryEmployeesReferenceStore(this.employees),
        handicaps: new InMemoryHandicapsReferenceStore(this.handicaps),
        financialConfigs: new InMemoryFinancialConfigsStore(this.financialConfigs, () => `financial-config-${++this.counters.financialConfig}`),
        paymentMethods: new InMemoryPaymentMethodsStore(this.paymentMethods),
        paymentCommissionRules: new InMemoryPaymentCommissionRulesStore(this.paymentCommissionRules, () => `commission-rule-${++this.counters.commissionRule}`),
        financialIncomeCategories: new InMemoryFinancialIncomeCategoriesStore(this.financialIncomeCategories),
        financialExpenseCategories: new InMemoryFinancialExpenseCategoriesStore(this.financialExpenseCategories),
        financialMovements: new InMemoryFinancialMovementsStore(this.financialMovements, () => `movement-${++this.counters.movement}`),
        macroDebitSettlements: new InMemoryMacroDebitSettlementsStore(this.macroDebitSettlements, () => `settlement-${++this.counters.settlement}`),
        salaryConfigurations: new InMemorySalaryConfigurationsStore(this.salaryConfigurations, () => `salary-configuration-${++this.counters.salaryConfiguration}`),
        salaryPayments: new InMemorySalaryPaymentsStore(this.salaryPayments, () => `salary-payment-${++this.counters.salaryPayment}`),
        externalAccountingReferences: new InMemoryExternalAccountingReferencesStore(this.externalAccountingReferences, () => `external-reference-${++this.counters.externalReference}`),
        expenseSubmissions: new InMemoryExpenseSubmissionsStore(this.expenseSubmissions, () => `expense-submission-${++this.counters.expenseSubmission}`),
        concessionContracts: new InMemoryConcessionContractsStore(this.concessionContracts, () => `concession-contract-${++this.counters.concessionContract}`),
        advertisingContracts: new InMemoryAdvertisingContractsStore(this.advertisingContracts, () => `advertising-contract-${++this.counters.advertisingContract}`),
        handicapCharges: new InMemoryHandicapChargesStore(this.handicapCharges, () => `handicap-charge-${++this.counters.handicapCharge}`),
        memberFeeCharges: new InMemoryMemberFeeChargesStore(this.memberFeeCharges, () => `member-fee-charge-${++this.counters.memberFeeCharge}`),
    };
    async runInTransaction(handler) {
        return handler(this.dataAccess);
    }
    getDataAccess() {
        return this.dataAccess;
    }
}
export function createAccountingActor(uid, roleIds, claims) {
    const user = {
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
            directivo: roleIds.includes('directivo'),
            administrativo: roleIds.includes('administrativo'),
            empleado: roleIds.includes('empleado'),
            socio: roleIds.includes('socio'),
            claimsVersion: 1,
            ...claims,
        },
    };
}
export function seedAccountingUser(manager, uid, overrides) {
    const user = {
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
export function seedAccountingMember(manager, memberId, overrides) {
    const member = {
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
export function seedAccountingFamilyGroup(manager, groupId, overrides) {
    const familyGroup = {
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
export function seedAccountingEmployee(manager, employeeId, overrides) {
    const employee = {
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
export function seedAccountingHandicap(manager, handicapId, overrides) {
    const handicap = {
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
export function seedActiveFinancialConfig(manager, configId = 'financial-config-active', overrides) {
    const config = {
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
        familyGroupBillingMode: 'per_member',
        allowStandaloneMinor: true,
        membershipChargePersistenceMode: 'member_fee_charges',
        greenFeeAppliesToMembers: true,
        cantineroContractMode: 'fixed_monthly',
        advertisingDefaultPeriodicity: 'monthly',
        requireApprovalForExpensePosting: true,
        requireApprovalForOvertimePosting: true,
        ...createAudit(),
        ...overrides,
    };
    manager.financialConfigs.set(configId, config);
    return config;
}
export function seedPaymentMethod(manager, paymentMethodId, overrides) {
    const method = {
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
export function seedCommissionRule(manager, ruleId, overrides) {
    const rule = {
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
export function seedIncomeCategory(manager, categoryId, overrides) {
    const category = {
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
export function seedExpenseCategory(manager, categoryId, overrides) {
    const category = {
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
//# sourceMappingURL=accounting-fakes.js.map