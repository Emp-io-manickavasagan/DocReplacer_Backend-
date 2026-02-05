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
    // Test the connection by making a simple query with timeout
    const { data, error } = await supabase
      .from('users')
      .select('count')
      .limit(1)
      .abortSignal(AbortSignal.timeout(10000)); // 10 second timeout
    
    if (error) {
      return; // Don't throw, just warn
    }
    
  } catch (error) {
    // Don't throw error, let server start anyway
    return;
  }
}

export { supabase };