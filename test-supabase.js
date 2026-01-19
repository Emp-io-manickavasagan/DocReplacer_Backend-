// Simple test script to verify Supabase connection
// Run with: node test-supabase.js

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function testSupabaseConnection() {
  console.log('Testing Supabase connection...');
  
  // Check environment variables
  if (!process.env.SUPABASE_URL) {
    console.error('❌ SUPABASE_URL not set in environment variables');
    return;
  }
  
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set in environment variables');
    return;
  }
  
  console.log('✅ Environment variables found');
  console.log('📍 Supabase URL:', process.env.SUPABASE_URL);
  
  try {
    // Create Supabase client
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );
    
    console.log('✅ Supabase client created');
    
    // Test connection by querying users table
    const { data, error } = await supabase
      .from('users')
      .select('count')
      .limit(1);
    
    if (error) {
      console.error('❌ Database query failed:', error.message);
      console.log('💡 Make sure you have run the schema SQL in your Supabase project');
      return;
    }
    
    console.log('✅ Database connection successful');
    console.log('🎉 Supabase setup is working correctly!');
    
  } catch (error) {
    console.error('❌ Connection test failed:', error.message);
  }
}

testSupabaseConnection();