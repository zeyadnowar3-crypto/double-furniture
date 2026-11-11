const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://sntvolehgpxztjmkpqqi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNudHZvbGVoZ3B4enRqbWtwcXFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyNTQwNDgsImV4cCI6MjEwMzgzMDA0OH0.VoqTlqQd5eLLmztJepxem-pgm3e1zM8JdQlstu3VhIk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false }
});

module.exports = { supabase };
