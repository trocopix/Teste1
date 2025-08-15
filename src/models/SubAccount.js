/*
 * Modelo SubAccount - Supabase
 * Substitui Mongoose por operações diretas no Supabase
 */

const supabase = require('../config/supabase');

class SubAccount {
  constructor(data) {
    this.id = data.id;
    this.user_id = data.user_id;
    this.name = data.name;
    this.balance = parseFloat(data.balance) || 0;
    this.max_pix_amount = parseFloat(data.max_pix_amount) || 99.99;
    this.daily_pix_limit = parseFloat(data.daily_pix_limit) || 1000;
    this.daily_pix_used = parseFloat(data.daily_pix_used) || 0;
    this.daily_pix_count = parseInt(data.daily_pix_count) || 0;
    this.is_active = data.is_active;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  // Criar nova subconta
  static async create(subAccountData) {
    try {
      const { data, error } = await supabase
        .from('sub_accounts')
        .insert([{
          user_id: subAccountData.user_id,
          name: subAccountData.name,
          balance: subAccountData.balance || 0,
          max_pix_amount: subAccountData.max_pix_amount || 99.99,
          daily_pix_limit: subAccountData.daily_pix_limit || 1000,
          daily_pix_used: 0,
          daily_pix_count: 0,
          is_active: true,
          created_at: new Date().toISOString()
        }])
        .select();

      if (error) throw new Error(error.message);
      return new SubAccount(data[0]);
    } catch (error) {
      throw new Error(`Erro ao criar subconta: ${error.message}`);
    }
  }

  // Buscar por ID
  static async findById(id) {
    try {
      const { data, error } = await supabase
        .from('sub_accounts')
        .select('*')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (error) throw new Error(error.message);
      return data ? new SubAccount(data) : null;
    } catch (error) {
      throw new Error(`Erro ao buscar subconta: ${error.message}`);
    }
  }

  // Buscar por usuário
  static async findByUserId(userId) {
    try {
      const { data, error } = await supabase
        .from('sub_accounts')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (error) throw new Error(error.message);
      return data.map(account => new SubAccount(account));
    } catch (error) {
      throw new Error(`Erro ao buscar subcontas: ${error.message}`);
    }
  }

  // Buscar primeira subconta do usuário
  static async findOneByUserId(userId) {
    try {
      const { data, error } = await supabase
        .from('sub_accounts')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw new Error(error.message);
      return data ? new SubAccount(data) : null;
    } catch (error) {
      throw new Error(`Erro ao buscar subconta: ${error.message}`);
    }
  }

  // Verificar se pode fazer PIX
  canMakePix(amount) {
    if (!this.is_active) {
      return { can: false, reason: 'Subconta inativa' };
    }

    if (amount > this.max_pix_amount) {
      return { 
        can: false, 
        reason: `Valor excede limite por transação (R$ ${this.max_pix_amount})` 
      };
    }

    if (this.daily_pix_used + amount > this.daily_pix_limit) {
      return { 
        can: false, 
        reason: `Valor excede limite diário (R$ ${this.daily_pix_limit})` 
      };
    }

    if (this.balance < amount) {
      return { 
        can: false, 
        reason: `Saldo insuficiente (R$ ${this.balance})` 
      };
    }

    return { can: true };
  }

  // Debitar valor
  async debitAmount(amount) {
    try {
      const { data, error } = await supabase
        .from('sub_accounts')
        .update({
          balance: this.balance - amount,
          daily_pix_used: this.daily_pix_used + amount,
          daily_pix_count: this.daily_pix_count + 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', this.id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      
      // Atualizar instância
      Object.assign(this, data);
      this.balance = parseFloat(data.balance);
      this.daily_pix_used = parseFloat(data.daily_pix_used);
      this.daily_pix_count = parseInt(data.daily_pix_count);
      
      return this;
    } catch (error) {
      throw new Error(`Erro ao debitar valor: ${error.message}`);
    }
  }

  // Adicionar saldo (admin)
  async addBalance(amount) {
    try {
      const { data, error } = await supabase
        .from('sub_accounts')
        .update({
          balance: this.balance + amount,
          updated_at: new Date().toISOString()
        })
        .eq('id', this.id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      
      // Atualizar instância
      Object.assign(this, data);
      this.balance = parseFloat(data.balance);
      
      return this;
    } catch (error) {
      throw new Error(`Erro ao adicionar saldo: ${error.message}`);
    }
  }

  // Atualizar configurações
  async updateSettings(settings) {
    try {
      const { data, error } = await supabase
        .from('sub_accounts')
        .update({
          ...settings,
          updated_at: new Date().toISOString()
        })
        .eq('id', this.id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      
      // Atualizar instância
      Object.assign(this, data);
      
      return this;
    } catch (error) {
      throw new Error(`Erro ao atualizar configurações: ${error.message}`);
    }
  }

  // Resetar contadores diários
  async resetDailyCounters() {
    try {
      const { data, error } = await supabase
        .from('sub_accounts')
        .update({
          daily_pix_used: 0,
          daily_pix_count: 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', this.id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      
      // Atualizar instância
      this.daily_pix_used = 0;
      this.daily_pix_count = 0;
      
      return this;
    } catch (error) {
      throw new Error(`Erro ao resetar contadores: ${error.message}`);
    }
  }

  // Desativar subconta
  async deactivate() {
    try {
      const { error } = await supabase
        .from('sub_accounts')
        .update({ 
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', this.id);

      if (error) throw new Error(error.message);
      this.is_active = false;
    } catch (error) {
      throw new Error(`Erro ao desativar subconta: ${error.message}`);
    }
  }

  // Getters para compatibilidade
  get remainingDailyLimit() {
    return Math.max(0, this.daily_pix_limit - this.daily_pix_used);
  }

  get formattedBalance() {
    return `R$ ${this.balance.toFixed(2).replace('.', ',')}`;
  }

  get formattedDailyUsed() {
    return `R$ ${this.daily_pix_used.toFixed(2).replace('.', ',')}`;
  }
}

module.exports = SubAccount;
