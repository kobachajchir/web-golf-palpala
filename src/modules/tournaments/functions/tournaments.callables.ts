import { httpsCallable, type Functions } from 'firebase/functions';
import { getFirebaseFunctions } from '../../../lib/firebaseFunctions';
import { TOURNAMENTS_CALLABLE_NAMES } from '../domain/constants';
import type {
  RecordTournamentRegistrationPaymentPayload,
  RecordTournamentRegistrationPaymentResult,
  RegisterTournamentParticipantPayload,
  RegisterTournamentParticipantResult,
} from '../domain/models';

function getTournamentFunctions(functionsInstance?: Functions): Functions {
  return getFirebaseFunctions(functionsInstance);
}

export function createTournamentCallables(functionsInstance?: Functions) {
  const functionsRef = getTournamentFunctions(functionsInstance);

  return {
    async registerParticipant(payload: RegisterTournamentParticipantPayload) {
      return (await httpsCallable<RegisterTournamentParticipantPayload, RegisterTournamentParticipantResult>(
        functionsRef,
        TOURNAMENTS_CALLABLE_NAMES.registerParticipant,
      )(payload)).data;
    },
    async recordRegistrationPayment(payload: RecordTournamentRegistrationPaymentPayload) {
      return (await httpsCallable<RecordTournamentRegistrationPaymentPayload, RecordTournamentRegistrationPaymentResult>(
        functionsRef,
        TOURNAMENTS_CALLABLE_NAMES.recordRegistrationPayment,
      )(payload)).data;
    },
  };
}

export type TournamentCallableApi = ReturnType<typeof createTournamentCallables>;
