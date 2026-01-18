export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

const isDevEnv = (): boolean =>
    process.env.NODE_ENV === 'development'
    || process.env.npm_lifecycle_event === 'dev'
    || Boolean(process.env.TSX_WATCH)
    || Boolean(process.env.TSX_DEV);

const resolveLogLevel = (): LogLevel => {
    const envLevel = (process.env.FANSONE_LOG_LEVEL ?? '').toLowerCase();
    if (envLevel === 'debug' || envLevel === 'info' || envLevel === 'warn' || envLevel === 'error') {
        return envLevel;
    }
    return isDevEnv() ? 'debug' : 'info';
};

const activeLevel = resolveLogLevel();

const shouldLog = (level: LogLevel) => LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[activeLevel];

const writeLog = (level: LogLevel, args: unknown[]) => {
    if (!shouldLog(level)) {
        return;
    }
    if (level === 'warn') {
        console.warn(...args);
        return;
    }
    if (level === 'error') {
        console.error(...args);
        return;
    }
    console.log(...args);
};

export const logger = {
    debug: (...args: unknown[]) => writeLog('debug', args),
    info: (...args: unknown[]) => writeLog('info', args),
    warn: (...args: unknown[]) => writeLog('warn', args),
    error: (...args: unknown[]) => writeLog('error', args),
    level: activeLevel,
};

