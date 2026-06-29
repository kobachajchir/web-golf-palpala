import type { Clock } from '../../../accounting/domain/ports.js';
import type { EntityWithId, TournamentDocument } from '../../domain/models.js';
import type { TournamentsTransactionManager } from '../../domain/ports.js';

const TOURNAMENT_WINDOW_SYNC_ACTOR_UID = 'tournament-registration-window-sync';
const ARGENTINA_TIME_ZONE_OFFSET = '-03:00';

type RegistrationWindowAction = {
  tournamentId: string;
  tournamentName: string;
  previousStatus: TournamentDocument['status'];
  nextStatus: TournamentDocument['status'];
};

export type SyncTournamentRegistrationWindowsResult = {
  opened: RegistrationWindowAction[];
  closed: RegistrationWindowAction[];
  skippedInvalidSchedule: Array<{
    tournamentId: string;
    tournamentName: string;
    registrationOpenAt?: string | null;
    registrationCloseAt?: string | null;
  }>;
};

function buildInvalidScheduleEntry(tournament: EntityWithId<TournamentDocument>) {
  return {
    tournamentId: tournament.id,
    tournamentName: tournament.name,
    ...(tournament.registrationOpenAt !== undefined ? { registrationOpenAt: tournament.registrationOpenAt } : {}),
    ...(tournament.registrationCloseAt !== undefined ? { registrationCloseAt: tournament.registrationCloseAt } : {}),
  };
}

function parseRegistrationWindowDateTime(value?: string | null): Date | null {
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

function shouldOpenRegistration(tournament: EntityWithId<TournamentDocument>, now: Date, openAt: Date | null, closeAt: Date | null): boolean {
  return (
    tournament.status === 'scheduled'
    && openAt !== null
    && openAt.getTime() <= now.getTime()
    && (closeAt === null || closeAt.getTime() > now.getTime())
  );
}

function shouldCloseRegistration(tournament: EntityWithId<TournamentDocument>, now: Date, closeAt: Date | null): boolean {
  return tournament.status === 'registration_open' && closeAt !== null && closeAt.getTime() <= now.getTime();
}

export async function syncTournamentRegistrationWindowsUseCase(params: {
  transactions: TournamentsTransactionManager;
  clock: Clock;
}): Promise<SyncTournamentRegistrationWindowsResult> {
  const result: SyncTournamentRegistrationWindowsResult = {
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
        await dataAccess.tournaments.update(
          tournament.id,
          { status: 'registration_closed' },
          TOURNAMENT_WINDOW_SYNC_ACTOR_UID,
        );
        result.closed.push({
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          previousStatus: tournament.status,
          nextStatus: 'registration_closed',
        });
        continue;
      }

      if (shouldOpenRegistration(tournament, now, openAt, closeAt)) {
        await dataAccess.tournaments.update(
          tournament.id,
          { status: 'registration_open' },
          TOURNAMENT_WINDOW_SYNC_ACTOR_UID,
        );
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
