// startup-check.js (ESM compatible)

console.log('🔍 Checking server startup requirements...');

// Node.js version
console.log(`📦 Node.js version: ${process.version}`);

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
  } else {
    console.log(`✅ ${varName}: configured`);
  }
}

if (missingVars.length > 0) {
  console.error('❌ Missing environment variables:', missingVars.join(', '));
  process.exit(1);
}

// JWT_SECRET validation
if (process.env.JWT_SECRET.length < 32) {
  console.error('❌ JWT_SECRET must be at least 32 characters long');
  process.exit(1);
}

console.log('✅ JWT_SECRET: valid length');

// Port check
const port = process.env.PORT || '5000';
console.log(`🚪 Port: ${port}`);

// ESM-safe module import test
try {
  console.log('📚 Testing module imports...');
  await import('express');
  await import('dotenv/config');
  console.log('✅ Express imported');
  console.log('✅ Dotenv imported');
  console.log('🎉 Startup requirements check passed!');
} catch (error) {
  console.error('❌ Module import failed:', error);
  process.exit(1);
}
