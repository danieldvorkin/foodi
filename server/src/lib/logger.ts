import pino from 'pino';

export function createLogger(level: string, pretty: boolean) {
  return pino({
    level,
    // Never let a credential reach the log line, even by accident.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.apiKey',
        '*.accessToken',
        '*.refreshToken',
        '*.idToken',
        '*.access_token',
        '*.refresh_token',
        '*.id_token',
        '*.code',
      ],
      censor: '[redacted]',
    },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;
