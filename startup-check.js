// startup-check.js (ESM compatible)
import 'dotenv/config';

// Node.js version check
const nodeVersion = process.version;

// Required environment variables
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET'
];

const missingVars = [];

for (const varName of requiredEnvVars) {
  if (!process.env[varName]) {
    missingVars.push(varName);
  }
}

if (missingVars.length > 0) {
  process.exit(1);
}

// JWT_SECRET validation
if (process.env.JWT_SECRET.length < 32) {
  process.exit(1);
}

// Port check
const port = process.env.PORT || '5000';

// ESM-safe module import test
try {
  await import('express');
  await import('dotenv/config');
} catch (error) {
  process.exit(1);
}
