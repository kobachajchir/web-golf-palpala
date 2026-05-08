export function listMovementsByPeriod(transactions, filters) {
    return transactions.getDataAccess().financialMovements.listPage(filters);
}
export function listMovementsByCategory(transactions, filters) {
    return transactions.getDataAccess().financialMovements.listPage(filters);
}
export function listMovementsByPaymentMethod(transactions, filters) {
    return transactions.getDataAccess().financialMovements.listPage(filters);
}
export function listMovementsByThirdParty(transactions, filters) {
    return transactions.getDataAccess().financialMovements.listPage(filters);
}
export function listMovementsByBankingFlag(transactions, filters) {
    return transactions.getDataAccess().financialMovements.listPage(filters);
}
export function listMovementsByTaxFlag(transactions, filters) {
    return transactions.getDataAccess().financialMovements.listPage(filters);
}
export function listSalaryPayments(transactions, filters) {
    return transactions.getDataAccess().salaryPayments.listPage(filters);
}
export function listHandicapCharges(transactions, filters) {
    return transactions.getDataAccess().handicapCharges.listPage(filters);
}
export function listMemberFeeCharges(transactions, filters) {
    return transactions.getDataAccess().memberFeeCharges.listPage(filters);
}
//# sourceMappingURL=reporting.queries.js.map