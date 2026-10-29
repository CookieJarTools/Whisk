/** Whisk runs on Windows and Linux. The few things that differ, like install commands, ask this. */
export const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')
