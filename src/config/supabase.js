/*
 * Configuração Supabase - Sistema de Troco Automático
 * Substitui MongoDB por PostgreSQL via Supabase
 */

const { createClient } = require('@supabase/supabase-js');

// Configurações do Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
}

// Criar cliente Supabase
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
