const requiredEnvVars = [
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'S3_ENDPOINT',
  'S3_BACKEND_ACCESS_KEY',
  'S3_BACKEND_SECRET_KEY',
];

// Development falls back to a seeded admin; production must not, or it would
// start with a publicly known admin login.
const productionOnlyEnvVars = ['DEFAULT_ADMIN_EMAIL', 'DEFAULT_ADMIN_PASSWORD'];

export function validateEnv(config: Record<string, unknown>) {
  const requiredKeys =
    config.NODE_ENV === 'production'
      ? [...requiredEnvVars, ...productionOnlyEnvVars]
      : requiredEnvVars;

  const missingVars = requiredKeys.filter((key) => {
    const value = config[key];
    return typeof value !== 'string' || value.trim() === '';
  });

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missingVars.join(', ')}`,
    );
  }

  return config;
}
