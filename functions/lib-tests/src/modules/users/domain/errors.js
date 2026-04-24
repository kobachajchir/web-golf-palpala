export class AppError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
    }
}
export function assertCondition(condition, code, message, details) {
    if (!condition) {
        throw new AppError(code, message, details);
    }
}
export function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=errors.js.map