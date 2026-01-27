// Simple startup verification script
console.log('🔍 Checking server startup requirements...');

// Check Node.js version
console.log(`📦 Node.js version: ${process.version}`);

// Check environment variables
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET'];
let missingVars = [];

requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    missingVars.push(varName);
  } else {
    console.log(`✅ ${varName}: configured`);
  }
});

if (missingVars.length > 0) {
  console.error('❌ Missing environment variables:', missingVars.join(', '));
  process.exit(1);
}

// Check JWT_SECRET length
if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  console.error('❌ JWT_SECRET must be at least 32 characters long');
  process.exit(1);
}

console.log('✅ JWT_SECRET: valid length');

// Check port
const port = process.env.PORT || '5000';
console.log(`🚪 Port: ${port}`);

// Check if we can import the main modules
try {
  console.log('📚 Testing module imports...');
  
  // Test basic imports
  require('express');
  console.log('✅ Express imported');
  
  require('dotenv/config');
  console.log('✅ Dotenv imported');
  
  console.log('✅ All basic modules imported successfully');
  console.log('🎉 Startup requirements check passed!');
  
} catch (error) {
  console.error('❌ Module import failed:', error.message);
  process.exit(1);
}