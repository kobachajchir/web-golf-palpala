import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { parseRecordTournamentRegistrationPaymentInput, parseRegisterTournamentParticipantInput, recordTournamentRegistrationPaymentUseCase, registerTournamentParticipantUseCase, } from '../application/use-cases/registration.use-cases.js';
import { resolveActor, toHttpsError } from '../../accounting/application/shared.js';
import { FirestoreAccountingTransactionManager, SystemClock } from '../../accounting/infrastructure/firestore/repositories.js';
import { FirestoreTournamentsTransactionManager } from '../infrastructure/firestore/repositories.js';
const clock = new SystemClock();
const accountingTransactions = new FirestoreAccountingTransactionManager(clock);
const tournamentTransactions = new FirestoreTournamentsTransactionManager();
async function getActorFromCallableRequest(auth) {
    return resolveActor(accountingTransactions.getDataAccess(), auth
        ? {
            uid: auth.uid,
            token: auth.token,
        }
        : null);
}
function withCallableLogging(functionName, error) {
    logger.error(`${functionName} failed`, error);
    throw toHttpsError(error);
}
export const tournamentsRegisterParticipant = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return registerTournamentParticipantUseCase({
            actor,
            input: parseRegisterTournamentParticipantInput(request.data),
            transactions: tournamentTransactions,
            clock,
        });
    }
    catch (error) {
        withCallableLogging('tournamentsRegisterParticipant', error);
    }
});
export const tournamentsRecordRegistrationPayment = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return recordTournamentRegistrationPaymentUseCase({
            actor,
            input: parseRecordTournamentRegistrationPaymentInput(request.data),
            transactions: tournamentTransactions,
            clock,
        });
    }
    catch (error) {
        withCallableLogging('tournamentsRecordRegistrationPayment', error);
    }
});
export const tournaments = {
    registerParticipant: tournamentsRegisterParticipant,
    recordRegistrationPayment: tournamentsRecordRegistrationPayment,
};
//# sourceMappingURL=tournaments.callables.js.map