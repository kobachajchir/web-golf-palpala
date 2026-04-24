import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { syncCustomClaimsUseCase, } from '../application/use-cases/auth.use-cases.js';
import { createEmployeeUseCase, parseCreateEmployeeInput, parseUpdateEmployeeInput, updateEmployeeUseCase, } from '../application/use-cases/employee.use-cases.js';
import { addMemberToFamilyGroupUseCase, createFamilyGroupUseCase, parseAddMemberToFamilyGroupInput, parseCreateFamilyGroupInput, parseRemoveMemberFromFamilyGroupInput, removeMemberFromFamilyGroupUseCase, } from '../application/use-cases/family-group.use-cases.js';
import { parseRecordHandicapInput, recordHandicapUseCase } from '../application/use-cases/handicap.use-cases.js';
import { createMemberUseCase, endLicenseUseCase, parseCreateMemberInput, parseEndLicenseInput, parseStartLicenseInput, parseUpdateMemberInput, startLicenseUseCase, updateMemberUseCase, } from '../application/use-cases/member.use-cases.js';
import { assignRoleUseCase, parseAssignRoleInput } from '../application/use-cases/role.use-cases.js';
import { resolveActor, toHttpsError } from '../application/shared.js';
import { FirebaseAuthGateway } from '../infrastructure/firestore/auth-gateway.js';
import { FirestoreUsersTransactionManager, SystemClock } from '../infrastructure/firestore/repositories.js';
const transactions = new FirestoreUsersTransactionManager(new SystemClock());
const authGateway = new FirebaseAuthGateway();
async function getActorFromCallableRequest(auth) {
    return resolveActor(transactions.getDataAccess(), auth
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
export const usersCreateMember = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return createMemberUseCase({
            actor,
            input: parseCreateMemberInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('usersCreateMember', error);
    }
});
export const usersUpdateMember = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return updateMemberUseCase({
            actor,
            input: parseUpdateMemberInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('usersUpdateMember', error);
    }
});
export const usersCreateFamilyGroup = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return createFamilyGroupUseCase({
            actor,
            input: parseCreateFamilyGroupInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('usersCreateFamilyGroup', error);
    }
});
export const usersAddMemberToFamilyGroup = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return addMemberToFamilyGroupUseCase({
            actor,
            input: parseAddMemberToFamilyGroupInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('usersAddMemberToFamilyGroup', error);
    }
});
export const usersRemoveMemberFromFamilyGroup = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return removeMemberFromFamilyGroupUseCase({
            actor,
            input: parseRemoveMemberFromFamilyGroupInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('usersRemoveMemberFromFamilyGroup', error);
    }
});
export const usersStartLicense = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return startLicenseUseCase({
            actor,
            input: parseStartLicenseInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('usersStartLicense', error);
    }
});
export const usersEndLicense = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return endLicenseUseCase({
            actor,
            input: parseEndLicenseInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('usersEndLicense', error);
    }
});
export const usersCreateEmployee = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return createEmployeeUseCase({
            actor,
            input: parseCreateEmployeeInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('usersCreateEmployee', error);
    }
});
export const usersUpdateEmployee = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return updateEmployeeUseCase({
            actor,
            input: parseUpdateEmployeeInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('usersUpdateEmployee', error);
    }
});
export const usersAssignRole = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return assignRoleUseCase({
            actor,
            input: parseAssignRoleInput(request.data),
            transactions,
            authGateway,
        });
    }
    catch (error) {
        withCallableLogging('usersAssignRole', error);
    }
});
export const usersSyncCustomClaims = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        const data = request.data;
        const uid = typeof data?.uid === 'string' ? data.uid.trim() : '';
        return syncCustomClaimsUseCase({
            actor,
            targetUid: uid,
            transactions,
            authGateway,
        });
    }
    catch (error) {
        withCallableLogging('usersSyncCustomClaims', error);
    }
});
export const usersRecordHandicap = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return recordHandicapUseCase({
            actor,
            input: parseRecordHandicapInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('usersRecordHandicap', error);
    }
});
export const users = {
    createMember: usersCreateMember,
    updateMember: usersUpdateMember,
    createFamilyGroup: usersCreateFamilyGroup,
    addMemberToFamilyGroup: usersAddMemberToFamilyGroup,
    removeMemberFromFamilyGroup: usersRemoveMemberFromFamilyGroup,
    startLicense: usersStartLicense,
    endLicense: usersEndLicense,
    createEmployee: usersCreateEmployee,
    updateEmployee: usersUpdateEmployee,
    assignRole: usersAssignRole,
    syncCustomClaims: usersSyncCustomClaims,
    recordHandicap: usersRecordHandicap,
};
//# sourceMappingURL=users.callables.js.map