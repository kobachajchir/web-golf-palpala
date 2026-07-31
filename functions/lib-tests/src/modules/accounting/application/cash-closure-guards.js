import { assertCondition } from '../domain/errors.js';
function toClubDayKey(date) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}
function formatClubDate(dayKey) {
    const [year, month, day] = dayKey.split('-');
    return `${day}/${month}/${year}`;
}
function getClosureDayKey(closure) {
    return toClubDayKey(closure.closureDate.toDate());
}
function getOpenClosureBefore(closures, dayKey) {
    return closures
        .filter((closure) => getClosureDayKey(closure) < dayKey)
        .sort((left, right) => getClosureDayKey(left).localeCompare(getClosureDayKey(right)))[0] ?? null;
}
export async function assertCashClosureCanOpen(params) {
    const closureDay = toClubDayKey(params.closureDate);
    const todayDay = toClubDayKey(new Date());
    assertCondition(closureDay <= todayDay, 'failed-precondition', 'No se puede abrir una caja con fecha futura.');
    const openClosures = await params.dataAccess.cashClosures.listOpen();
    const sameDayOpenClosure = openClosures.find((closure) => getClosureDayKey(closure) === closureDay) ?? null;
    assertCondition(!sameDayOpenClosure, 'failed-precondition', `Ya existe una caja abierta para el ${formatClubDate(closureDay)}.`);
    const previousOpenClosure = getOpenClosureBefore(openClosures, closureDay);
    if (previousOpenClosure) {
        assertCondition(false, 'failed-precondition', `Hay una caja anterior abierta (${formatClubDate(getClosureDayKey(previousOpenClosure))}). Cerrala antes de abrir una nueva jornada.`);
    }
}
export async function assertCashOperationDateAllowed(params) {
    const operationDay = toClubDayKey(params.operationDate);
    const todayDay = toClubDayKey(new Date());
    assertCondition(operationDay <= todayDay, 'failed-precondition', 'No se pueden registrar movimientos con fecha futura.');
    const openClosures = await params.dataAccess.cashClosures.listOpen();
    const previousOpenClosure = getOpenClosureBefore(openClosures, operationDay);
    if (previousOpenClosure) {
        assertCondition(false, 'failed-precondition', `Hay una caja anterior abierta (${formatClubDate(getClosureDayKey(previousOpenClosure))}). Cerrala antes de registrar movimientos nuevos.`);
    }
}
//# sourceMappingURL=cash-closure-guards.js.map