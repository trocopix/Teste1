/*
 * Configuração Supabase - Sistema de Troco Automático
 * Substitui MongoDB por PostgreSQL via Supabase
 */

const { createClient } = require('@supabase/supabase-js');

const connectDB = async () => {
  try {
    // Configurações do Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
    }

    // Criar cliente Supabase
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Testar conexão
    const { data, error } = await supabase
      .from('users')
      .select('count')
      .limit(1);

    if (error) {
      throw new Error(`Erro na conexão Supabase: ${error.message}`);
    }

    console.log('✅ Supabase conectado com sucesso');
    
    // Configurações globais
    global.supabase = supabase;
    
    // Tratamento de erros de conexão
    process.on('SIGINT', async () => {
      console.log('🔄 Supabase desconectado devido ao encerramento da aplicação');
      process.exit(0);
    });

    return supabase;

  } catch (error) {
    console.error('❌ Erro ao conectar com Supabase:', error);
    process.exit(1);
  }
};

module.exports = connectDB;
