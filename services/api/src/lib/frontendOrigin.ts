const developmentOrigins = new Set([
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3200',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
  'http://127.0.0.1:3200',
]);

export function isFrontendOriginAllowed(origin?: string): boolean {
  if (!origin) return true;

  const configuredOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return configuredOrigins.includes(origin)
    || (process.env.NODE_ENV !== 'production' && developmentOrigins.has(origin));
}
