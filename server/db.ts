import { supabase } from "./supabase";

if (!process.env.SUPABASE_URL) {
  throw new Error(
    "SUPABASE_URL must be set. Did you forget to configure Supabase?",
  );
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY must be set. Did you forget to configure Supabase?",
  );
}

export async function connectDB() {
  try {
    console.log('🔍 Testing database connection...');
    
    // Test the connection by making a simple query with timeout
    const { data, error } = await supabase
      .from('users')
      .select('count')
      .limit(1)
      .abortSignal(AbortSignal.timeout(10000)); // 10 second timeout
    
    if (error) {
      console.error('❌ Database connection test failed:', error.message);
      throw error;
    }
    
    console.log('✅ Database connection test successful');
    
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        console.error('❌ Database connection timeout (>10s)');
      } else {
        console.error('❌ Database connection error:', error.message);
      }
    } else {
      console.error('❌ Unknown database connection error:', error);
    }
    throw error; // Re-throw to be caught by the main error handler
  }
}

export { supabase };