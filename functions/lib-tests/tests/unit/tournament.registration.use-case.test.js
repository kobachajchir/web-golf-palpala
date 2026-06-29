import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { AppError } from '../../src/modules/accounting/domain/errors.js';
import { approveTournamentRegistrationUseCase, registerExternalTournamentParticipantUseCase, registerTournamentParticipantUseCase, } from '../../src/modules/tournaments/application/use-cases/registration.use-cases.js';
import { syncTournamentRegistrationWindowsUseCase } from '../../src/modules/tournaments/application/use-cases/registration-window.use-cases.js';
function timestamp(value = '2026-01-01T00:00:00.000Z') {
    return Timestamp.fromDate(new Date(value));
}
function createAudit(actorUid = 'system') {
    const now = timestamp();
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
function createMemberActor() {
    return {
        uid: 'user-member-1',
        claims: {
            socio: true,
            claimsVersion: 1,
        },
        user: {
            id: 'user-member-1',
            email: 'socio@example.com',
            displayName: 'Socio Real',
            primaryRoleId: 'socio',
            roleIds: ['socio'],
            profileType: 'member',
            profileId: 'member-1',
            active: true,
            claimsVersion: 1,
            ...createAudit('system'),
        },
    };
}
function createStaffActor() {
    return {
        uid: 'admin-1',
        claims: {
            administrativo: true,
            claimsVersion: 1,
        },
        user: {
            id: 'admin-1',
            email: 'admin@example.com',
            displayName: 'Administracion',
            primaryRoleId: 'administrativo',
            roleIds: ['administrativo'],
            profileType: 'employee',
            profileId: 'employee-1',
            active: true,
            claimsVersion: 1,
            ...createAudit('system'),
        },
    };
}
function createTournament(overrides = {}) {
    return {
        id: 'tournament-1',
        name: 'Torneo Firestore',
        date: '2026-07-18',
        status: 'registration_open',
        format: 'medal',
        startType: 'regular',
        capacity: 2,
        registered: 0,
        openDaysBefore: 14,
        membersOnly: false,
        allowNoHandicap: true,
        recurring: false,
        registrationOpenAt: '2026-07-01T09:00',
        registrationCloseAt: '2026-07-17T18:00',
        registrationFeeMinor: 15_000_00,
        reducedRegistrationFeeMinor: 10_000_00,
        operatingCostMinor: 0,
        operatingCostItems: [],
        prizeCostMinor: 0,
        costNotes: null,
        teeWindow: { first: '08:00', last: '12:00', interval: 8 },
        categories: [],
        pendingCards: 0,
        approvedCards: 0,
        leaderboard: [],
        ...createAudit('admin-1'),
        ...overrides,
    };
}
class InMemoryTournamentsStore {
    items;
    constructor(items) {
        this.items = items;
    }
    async getById(tournamentId) {
        return this.items.get(tournamentId) ?? null;
    }
    async listRegistrationWindowCandidates() {
        return Array.from(this.items.values()).filter((item) => item.status === 'scheduled' || item.status === 'registration_open');
    }
    async update(tournamentId, patch, actorUid) {
        const existing = this.items.get(tournamentId);
        if (!existing) {
            return;
        }
        this.items.set(tournamentId, {
            id: existing.id,
            ...applyPatch(existing, patch),
            updatedAt: timestamp(),
            updatedBy: actorUid,
        });
    }
}
class InMemoryTournamentRegistrationsStore {
    items;
    sequence = 0;
    constructor(items) {
        this.items = items;
    }
    async getById(registrationId) {
        return this.items.get(registrationId) ?? null;
    }
    async findDuplicate(params) {
        return Array.from(this.items.values()).find((item) => item.tournamentId === params.tournamentId
            && (params.memberId ? item.memberId === params.memberId : item.userId === params.userId)) ?? null;
    }
    async findExternalDuplicate(params) {
        return Array.from(this.items.values()).find((item) => item.tournamentId === params.tournamentId
            && item.participantEmailNormalized === params.participantEmailNormalized) ?? null;
    }
    async create(data, actorUid) {
        this.sequence += 1;
        const id = `registration-${this.sequence}`;
        this.items.set(id, {
            id,
            ...data,
            ...createAudit(actorUid),
        });
        return id;
    }
    async update(registrationId, patch, actorUid) {
        const existing = this.items.get(registrationId);
        if (!existing) {
            return;
        }
        this.items.set(registrationId, {
            id: existing.id,
            ...applyPatch(existing, patch),
            updatedAt: timestamp(),
            updatedBy: actorUid,
        });
    }
}
class InMemoryTournamentReceiptsStore {
    async getById(receiptId) {
        void receiptId;
        return null;
    }
    async create() {
        return 'receipt-1';
    }
}
class InMemoryTournamentsTransactionManager {
    tournaments = new Map();
    registrations = new Map();
    async runInTransaction(handler) {
        return handler(this.getDataAccess());
    }
    async runWithAccountingInTransaction() {
        throw new Error('No accounting transaction expected in tournament registration tests.');
    }
    getDataAccess() {
        return {
            tournaments: new InMemoryTournamentsStore(this.tournaments),
            registrations: new InMemoryTournamentRegistrationsStore(this.registrations),
            receipts: new InMemoryTournamentReceiptsStore(),
        };
    }
}
const fixedClock = {
    now: () => new Date('2026-07-01T12:00:00.000Z'),
};
test('inscripcion de torneo usa el documento Firestore como fuente de verdad', async () => {
    const manager = new InMemoryTournamentsTransactionManager();
    manager.tournaments.set('tournament-1', createTournament());
    const result = await registerTournamentParticipantUseCase({
        actor: createMemberActor(),
        input: {
            tournamentId: 'tournament-1',
            participantName: 'Socio Frontend',
            participantEmail: 'frontend@example.com',
            notes: 'Solicitud desde UI',
        },
        transactions: manager,
        clock: fixedClock,
    });
    const registration = manager.registrations.get(result.registrationId);
    assert.ok(registration);
    assert.equal(registration.tournamentNameSnapshot, 'Torneo Firestore');
    assert.equal(registration.tournamentDate.toDate().toISOString(), '2026-07-18T12:00:00.000Z');
    assert.equal(registration.amountMinor, 15_000_00);
    assert.equal(manager.tournaments.get('tournament-1')?.registered, 1);
});
test('inscripcion rechaza torneos sin cupo disponible', async () => {
    const manager = new InMemoryTournamentsTransactionManager();
    manager.tournaments.set('tournament-1', createTournament({ capacity: 1, registered: 1 }));
    await assert.rejects(() => registerTournamentParticipantUseCase({
        actor: createMemberActor(),
        input: {
            tournamentId: 'tournament-1',
        },
        transactions: manager,
        clock: fixedClock,
    }), (error) => error instanceof AppError && error.code === 'failed-precondition');
});
test('inscripcion externa queda pendiente de aprobacion sin consumir cupo', async () => {
    const manager = new InMemoryTournamentsTransactionManager();
    manager.tournaments.set('tournament-1', createTournament());
    const result = await registerExternalTournamentParticipantUseCase({
        input: {
            tournamentId: 'tournament-1',
            fullName: 'Invitada Externa',
            email: 'Invitada@Example.com',
            phone: '388 555',
            handicap: 18.5,
            aagLicense: 'AAG-123',
            notes: 'Club visitante',
        },
        transactions: manager,
        clock: fixedClock,
    });
    const registration = manager.registrations.get(result.registrationId);
    assert.ok(registration);
    assert.equal(registration.origin, 'external');
    assert.equal(registration.status, 'pending_approval');
    assert.equal(registration.approvalStatus, 'pending');
    assert.equal(registration.amountMinor, 15_000_00);
    assert.equal(registration.participantEmailNormalized, 'invitada@example.com');
    assert.equal(manager.tournaments.get('tournament-1')?.registered, 0);
});
test('aprobacion administrativa confirma cupo y deja la inscripcion pendiente de pago', async () => {
    const manager = new InMemoryTournamentsTransactionManager();
    manager.tournaments.set('tournament-1', createTournament());
    const externalResult = await registerExternalTournamentParticipantUseCase({
        input: {
            tournamentId: 'tournament-1',
            fullName: 'Invitado Externo',
            email: 'externo@example.com',
            handicap: 10,
            aagLicense: 'AAG-456',
        },
        transactions: manager,
        clock: fixedClock,
    });
    const result = await approveTournamentRegistrationUseCase({
        actor: createStaffActor(),
        input: {
            registrationId: externalResult.registrationId,
        },
        transactions: manager,
        clock: fixedClock,
    });
    const registration = manager.registrations.get(externalResult.registrationId);
    assert.equal(result.status, 'pending_payment');
    assert.ok(registration);
    assert.equal(registration.status, 'pending_payment');
    assert.equal(registration.approvalStatus, 'approved');
    assert.equal(registration.approvedByUid, 'admin-1');
    assert.equal(manager.tournaments.get('tournament-1')?.registered, 1);
});
test('sincronizacion programada abre torneos agendados al llegar la fecha de apertura', async () => {
    const manager = new InMemoryTournamentsTransactionManager();
    manager.tournaments.set('tournament-1', createTournament({
        status: 'scheduled',
        registrationOpenAt: '2026-07-01T09:00',
        registrationCloseAt: '2026-07-17T18:00',
    }));
    const result = await syncTournamentRegistrationWindowsUseCase({
        transactions: manager,
        clock: fixedClock,
    });
    assert.equal(manager.tournaments.get('tournament-1')?.status, 'registration_open');
    assert.equal(manager.tournaments.get('tournament-1')?.updatedBy, 'tournament-registration-window-sync');
    assert.deepEqual(result.opened.map((item) => item.tournamentId), ['tournament-1']);
    assert.deepEqual(result.closed, []);
});
test('sincronizacion programada cierra torneos abiertos al vencer la inscripcion', async () => {
    const manager = new InMemoryTournamentsTransactionManager();
    manager.tournaments.set('tournament-1', createTournament({
        status: 'registration_open',
        registrationOpenAt: '2026-06-01T09:00',
        registrationCloseAt: '2026-07-01T08:30',
    }));
    const result = await syncTournamentRegistrationWindowsUseCase({
        transactions: manager,
        clock: fixedClock,
    });
    assert.equal(manager.tournaments.get('tournament-1')?.status, 'registration_closed');
    assert.deepEqual(result.opened, []);
    assert.deepEqual(result.closed.map((item) => item.tournamentId), ['tournament-1']);
});
test('sincronizacion programada no reabre torneos cerrados manualmente', async () => {
    const manager = new InMemoryTournamentsTransactionManager();
    manager.tournaments.set('tournament-1', createTournament({
        status: 'registration_closed',
        registrationOpenAt: '2026-07-01T09:00',
        registrationCloseAt: '2026-07-17T18:00',
    }));
    const result = await syncTournamentRegistrationWindowsUseCase({
        transactions: manager,
        clock: fixedClock,
    });
    assert.equal(manager.tournaments.get('tournament-1')?.status, 'registration_closed');
    assert.deepEqual(result.opened, []);
    assert.deepEqual(result.closed, []);
});
test('sincronizacion programada no abre torneos en borrador', async () => {
    const manager = new InMemoryTournamentsTransactionManager();
    manager.tournaments.set('tournament-1', createTournament({
        status: 'draft',
        registrationOpenAt: '2026-07-01T09:00',
        registrationCloseAt: '2026-07-17T18:00',
    }));
    const result = await syncTournamentRegistrationWindowsUseCase({
        transactions: manager,
        clock: fixedClock,
    });
    assert.equal(manager.tournaments.get('tournament-1')?.status, 'draft');
    assert.deepEqual(result.opened, []);
    assert.deepEqual(result.closed, []);
});
//# sourceMappingURL=tournament.registration.use-case.test.js.map