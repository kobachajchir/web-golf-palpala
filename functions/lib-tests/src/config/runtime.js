export function getRuntimeEnvironment() {
    return process.env.FUNCTIONS_EMULATOR === 'true' ? 'emulator' : 'cloud';
}
//# sourceMappingURL=runtime.js.map