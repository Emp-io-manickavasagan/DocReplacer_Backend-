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
    // Test the connection by making a simple query
    const { data, error } = await supabase
      .from('users')
      .select('count')
      .limit(1);
    
    if (error) {
      throw error;
    }
    
  } catch (error) {
    process.exit(1);
  }
}

export { supabase };