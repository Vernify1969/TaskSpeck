/**
 * One door for screens and tests.
 * No Supabase URL and anon key: localStorage (the demo).
 * Both set: the shared Supabase database.
 */
import { createLocalData } from './localData.js';

export async function createDataLayer(options = {}) {
  const url = options.url || '';
  const anonKey = options.anonKey || '';
  if (options.supabase || (url && anonKey)) {
    const { createSupabaseData } = await import('./supabaseData.js');
    let supabase = options.supabase;
    if (!supabase) {
      const { createClient } = await import('@supabase/supabase-js');
      supabase = createClient(url, anonKey);
    }
    return createSupabaseData({ supabase });
  }
  return createLocalData(options);
}
