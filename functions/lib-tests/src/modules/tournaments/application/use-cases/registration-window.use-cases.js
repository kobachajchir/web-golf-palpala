const TOURNAMENT_WINDOW_SYNC_ACTOR_UID = 'tournament-registration-window-sync';
const ARGENTINA_TIME_ZONE_OFFSET = '-03:00';
function buildInvalidScheduleEntry(tournament) {
    return {
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        ...(tournament.registrationOpenAt !== undefined ? { registrationOpenAt: tournament.registrationOpenAt } : {}),
        ...(tournament.registrationCloseAt !== undefined ? { registrationCloseAt: tournament.registrationCloseAt } : {}),
    };
}
function parseRegistrationWindowDateTime(value) {
    const text = value?.trim();
    if (!text) {
        return null;
    }
    const hasExplicitTimeZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(text);
    const normalized = hasExplicitTimeZone
        ? text
        : `${text}${text.length === 16 ? ':00' : ''}${ARGENTINA_TIME_ZONE_OFFSET}`;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
}
function shouldOpenRegistration(tournament, now, openAt, closeAt) {
    return (tournament.status === 'scheduled'
        && openAt !== null
        && openAt.getTime() <= now.getTime()
        && (closeAt === null || closeAt.getTime() > now.getTime()));
}
function shouldCloseRegistration(tournament, now, closeAt) {
    return tournament.status === 'registration_open' && closeAt !== null && closeAt.getTime() <= now.getTime();
}
export async function syncTournamentRegistrationWindowsUseCase(params) {
    const result = {
        opened: [],
        closed: [],
        skippedInvalidSchedule: [],
    };
    const now = params.clock.now();
    await params.transactions.runInTransaction(async (dataAccess) => {
        const tournaments = await dataAccess.tournaments.listRegistrationWindowCandidates();
        for (const tournament of tournaments) {
            if (tournament.isDeleted === true) {
                continue;
            }
            const openAt = parseRegistrationWindowDateTime(tournament.registrationOpenAt);
            const closeAt = parseRegistrationWindowDateTime(tournament.registrationCloseAt);
            const hasInvalidOpenAt = Boolean(tournament.registrationOpenAt) && openAt === null;
            const hasInvalidCloseAt = Boolean(tournament.registrationCloseAt) && closeAt === null;
            if (hasInvalidOpenAt || hasInvalidCloseAt) {
                result.skippedInvalidSchedule.push(buildInvalidScheduleEntry(tournament));
                continue;
            }
            if (shouldCloseRegistration(tournament, now, closeAt)) {
                await dataAccess.tournaments.update(tournament.id, { status: 'registration_closed' }, TOURNAMENT_WINDOW_SYNC_ACTOR_UID);
                result.closed.push({
                    tournamentId: tournament.id,
                    tournamentName: tournament.name,
                    previousStatus: tournament.status,
                    nextStatus: 'registration_closed',
                });
                continue;
            }
            if (shouldOpenRegistration(tournament, now, openAt, closeAt)) {
                await dataAccess.tournaments.update(tournament.id, { status: 'registration_open' }, TOURNAMENT_WINDOW_SYNC_ACTOR_UID);
                result.opened.push({
                    tournamentId: tournament.id,
                    tournamentName: tournament.name,
                    previousStatus: tournament.status,
                    nextStatus: 'registration_open',
                });
            }
        }
    });
    return result;
}
//# sourceMappingURL=registration-window.use-cases.js.map