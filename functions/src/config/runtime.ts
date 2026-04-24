export type RuntimeEnvironment = 'cloud' | 'emulator';

export function getRuntimeEnvironment(): RuntimeEnvironment {
  return process.env.FUNCTIONS_EMULATOR === 'true' ? 'emulator' : 'cloud';
}
