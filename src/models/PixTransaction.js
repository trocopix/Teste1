/*
 * Modelo PixTransaction - Supabase
 * Substitui Mongoose por operações diretas no Supabase
 */

const supabase = require('../config/supabase');

class PixTransaction {
  constructor(data) {
    this.id = data.id;
    this.sub_account_id = data.sub_account_id;
    this.user_id = data.user_id;
    this.pix_key = data.pix_key;
    this.pix_key_type = data.pix_key_type;
    this.amount = parseFloat(data.amount) || 0;
    this.status = data.status || 'pending';
    this.efi_bank_id = data.efi_bank_id;
    this.error_message = data.error_message;
    this.source = data.source || 'web';
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
    this.processed_at = data.processed_at;
  }

  // Criar nova transação
  static async create(transactionData) {
    try {
      const { data, error } = await supabase
        .from('pix_transactions')
        .insert([{
          sub_account_id: transactionData.sub_account_id,
          user_id: transactionData.user_id,
          pix_key: transactionData.pix_key,
          pix_key_type: transactionData.pix_key_type,
          amount: transactionData.amount,
          status: 'pending',
          source: transactionData.source || 'web',
          created_at: new Date().toISOString()
        }])
        .select();

      if (error) throw new Error(error.message);
      return new PixTransaction(data[0]);
    } catch (error) {
      throw new Error(`Erro ao criar transação: ${error.message}`);
    }
  }

  // Buscar por ID
  static async findById(id) {
    try {
      const { data, error } = await supabase
        .from('pix_transactions')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw new Error(error.message);
      return data ? new PixTransaction(data) : null;
    } catch (error) {
      throw new Error(`Erro ao buscar transação: ${error.message}`);
    }
  }

  // Buscar por subconta
  static async findBySubAccountId(subAccountId, limit = 50) {
    try {
      const { data, error } = await supabase
        .from('pix_transactions')
        .select('*')
        .eq('sub_account_id', subAccountId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw new Error(error.message);
      return data.map(tx => new PixTransaction(tx));
    } catch (error) {
      throw new Error(`Erro ao buscar transações: ${error.message}`);
    }
  }

  // Buscar por usuário
  static async findByUserId(userId, limit = 50) {
    try {
      const { data, error } = await supabase
        .from('pix_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw new Error(error.message);
      return data.map(tx => new PixTransaction(tx));
    } catch (error) {
      throw new Error(`Erro ao buscar transações: ${error.message}`);
    }
  }

  // Marcar como processando
  async markAsProcessing() {
    try {
      const { data, error } = await supabase
        .from('pix_transactions')
        .update({
          status: 'processing',
          updated_at: new Date().toISOString()
        })
        .eq('id', this.id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      
      this.status = 'processing';
      this.updated_at = data.updated_at;
      
      return this;
    } catch (error) {
      throw new Error(`Erro ao marcar como processando: ${error.message}`);
    }
  }

  // Marcar como concluído
  async markAsCompleted(efiBankId, response = null) {
    try {
      const { data, error } = await supabase
        .from('pix_transactions')
        .update({
          status: 'completed',
          efi_bank_id: efiBankId,
          processed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', this.id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      
      this.status = 'completed';
      this.efi_bank_id = efiBankId;
      this.processed_at = data.processed_at;
      this.updated_at = data.updated_at;
      
      return this;
    } catch (error) {
      throw new Error(`Erro ao marcar como concluído: ${error.message}`);
    }
  }

  // Marcar como falhou
  async markAsFailed(errorMessage) {
    try {
      const { data, error } = await supabase
        .from('pix_transactions')
        .update({
          status: 'failed',
          error_message: errorMessage,
          updated_at: new Date().toISOString()
        })
        .eq('id', this.id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      
      this.status = 'failed';
      this.error_message = errorMessage;
      this.updated_at = data.updated_at;
      
      return this;
    } catch (error) {
      throw new Error(`Erro ao marcar como falhou: ${error.message}`);
    }
  }

  // Cancelar transação
  async cancel() {
    try {
      const { data, error } = await supabase
        .from('pix_transactions')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString()
        })
        .eq('id', this.id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      
      this.status = 'cancelled';
      this.updated_at = data.updated_at;
      
      return this;
    } catch (error) {
      throw new Error(`Erro ao cancelar transação: ${error.message}`);
    }
  }

  // Estatísticas de transações
  static async getStats(userId) {
    try {
      const { data, error } = await supabase
        .from('pix_transactions')
        .select('status, amount')
        .eq('user_id', userId);

      if (error) throw new Error(error.message);

      const stats = {
        total: data.length,
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        total_amount: 0
      };

      data.forEach(tx => {
        stats[tx.status]++;
        if (tx.status === 'completed') {
          stats.total_amount += parseFloat(tx.amount);
        }
      });

      return stats;
    } catch (error) {
      throw new Error(`Erro ao obter estatísticas: ${error.message}`);
    }
  }

  // Buscar transações por período
  static async findByDateRange(userId, startDate, endDate, limit = 50) {
    try {
      const { data, error } = await supabase
        .from('pix_transactions')
        .select('*')
        .eq('user_id', userId)
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw new Error(error.message);
      return data.map(tx => new PixTransaction(tx));
    } catch (error) {
      throw new Error(`Erro ao buscar transações por período: ${error.message}`);
    }
  }

  // Getters para compatibilidade
  get statusLabel() {
    const labels = {
      'pending': 'Pendente',
      'processing': 'Processando',
      'completed': 'Concluído',
      'failed': 'Falhou',
      'cancelled': 'Cancelado'
    };
    return labels[this.status] || this.status;
  }

  get formattedAmount() {
    return `R$ ${this.amount.toFixed(2).replace('.', ',')}`;
  }

  get isCompleted() {
    return this.status === 'completed';
  }

  get isFailed() {
    return this.status === 'failed';
  }

  get isPending() {
    return this.status === 'pending';
  }
}

module.exports = PixTransaction;
