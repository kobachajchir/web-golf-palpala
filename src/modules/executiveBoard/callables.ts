import { httpsCallable, type Functions } from 'firebase/functions';
import { getFirebaseFunctions } from '../../lib/firebaseFunctions';

export type UpsertBoardMemberPayload = {
  termId: string;
  uid: string;
  memberId: string;
  memberNumber: string;
  positionCode: string;
  positionLabel: string;
  fullNameSnapshot: string;
  order: number;
  active?: boolean;
};

function getExecutiveBoardFunctions(functionsInstance?: Functions): Functions {
  return getFirebaseFunctions(functionsInstance);
}

export function createExecutiveBoardCallables(functionsInstance?: Functions) {
  const functionsRef = getExecutiveBoardFunctions(functionsInstance);

  return {
    async upsertBoardMember(payload: UpsertBoardMemberPayload) {
      return (await httpsCallable<UpsertBoardMemberPayload, { id: string }>(
        functionsRef,
        'executiveBoardUpsertBoardMember',
      )(payload)).data;
    },
  };
}
