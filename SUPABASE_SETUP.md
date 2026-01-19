# Supabase Migration Setup

This application has been migrated from MongoDB to Supabase. Follow these steps to set up your Supabase database:

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new account or sign in
2. Create a new project
3. Wait for the project to be fully provisioned

## 2. Get Your Supabase Credentials

From your Supabase project dashboard:

1. Go to **Settings** → **API**
2. Copy the following values:
   - **Project URL** (looks like: `https://your-project-id.supabase.co`)
   - **anon public** key (for frontend if needed)
   - **service_role** key (for backend - keep this secret!)

## 3. Update Environment Variables

Update your `.env` file with the Supabase credentials:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

## 4. Set Up Database Schema

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy the contents of `supabase-schema.sql` and run it in the SQL Editor
4. This will create all the necessary tables, indexes, and RLS policies

## 5. Verify Setup

1. Start your backend server: `npm run dev`
2. Check the console for "✅ Connected to Supabase successfully"
3. Test the `/health` endpoint to ensure database connectivity

## 6. Data Migration (if needed)

If you have existing MongoDB data to migrate:

1. Export your MongoDB data
2. Transform the data to match the new Supabase schema
3. Import using Supabase's bulk import tools or custom scripts

## Key Changes from MongoDB

- **User IDs**: Now use UUIDs instead of MongoDB ObjectIds
- **Field Names**: Snake_case instead of camelCase (e.g., `user_id` instead of `userId`)
- **Timestamps**: ISO strings instead of Date objects
- **Arrays**: Native PostgreSQL arrays instead of MongoDB arrays
- **Validation**: Moved from Mongoose schemas to Zod schemas

## Database Tables

- `users` - User accounts and subscription info
- `documents` - Document metadata and content
- `payments` - Payment and subscription records
- `otps` - One-time passwords for verification
- `guest_usage` - Guest user usage tracking
- `reviews` - User feedback and ratings

## Security

- Row Level Security (RLS) is enabled on all tables
- Service role bypasses RLS for backend operations
- All sensitive operations use the service role key
- Public anon key can be used for frontend if needed

## Troubleshooting

1. **Connection Issues**: Verify your SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
2. **Permission Errors**: Ensure you're using the service role key, not the anon key
3. **Schema Errors**: Make sure you've run the complete schema SQL
4. **UUID Errors**: Ensure all user ID references use proper UUID format

For more help, check the [Supabase Documentation](https://supabase.com/docs).