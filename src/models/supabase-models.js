/*
 * Modelos Supabase - Sistema de Troco Automático
 * Substitui Mongoose por operações diretas no Supabase
 */

const supabase = require('../config/supabase');

// ========================================
// MODELO USER (Empresa/Admin)
// ========================================

class UserModel {
  // Criar novo usuário
  static async create(userData) {
    const { data, error } = await supabase
      .from('users')
      .insert([{
        name: userData.name,
        email: userData.email,
        password_hash: userData.password_hash,
        company_name: userData.company_name,
        cnpj: userData.cnpj,
        phone: userData.phone,
        role: userData.role || 'company',
        is_active: true,
        created_at: new Date().toISOString()
      }])
      .select();

    if (error) throw new Error(error.message);
    return data[0];
  }

  // Buscar usuário por email
  static async findByEmail(email) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return data;
  }

  // Buscar usuário por ID
  static async findById(id) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  // Atualizar último login
  static async updateLastLogin(id) {
    const { error } = await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  // Atualizar perfil
  static async updateProfile(id, updateData) {
    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }
}

// ========================================
// MODELO SUB_ACCOUNT (Sub-conta)
// ========================================

class SubAccountModel {
  // Criar nova sub-conta
  static async create(subAccountData) {
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
    return data[0];
  }

  // Buscar sub-conta por ID
  static async findById(id) {
    const { data, error } = await supabase
      .from('sub_accounts')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  // Buscar sub-contas de um usuário
  static async findByUserId(userId) {
    const { data, error } = await supabase
      .from('sub_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) throw new Error(error.message);
    return data;
  }

  // Verificar se pode fazer PIX
  static async canMakePix(id, amount) {
    const subAccount = await this.findById(id);
    
    if (!subAccount || !subAccount.is_active) {
      return { can: false, reason: 'Sub-conta inativa' };
    }

    if (amount > subAccount.max_pix_amount) {
      return { can: false, reason: 'Valor excede limite por transação' };
    }

    if (subAccount.daily_pix_used + amount > subAccount.daily_pix_limit) {
      return { can: false, reason: 'Valor excede limite diário' };
    }

    if (subAccount.balance < amount) {
      return { can: false, reason: 'Saldo insuficiente' };
    }

    return { can: true };
  }

  // Debitar valor
  static async debit(id, amount) {
    const { data, error } = await supabase
      .from('sub_accounts')
      .update({
        balance: supabase.raw(`balance - ${amount}`),
        daily_pix_used: supabase.raw(`daily_pix_used + ${amount}`),
        daily_pix_count: supabase.raw(`daily_pix_count + 1`)
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  // Adicionar saldo (admin)
  static async addBalance(id, amount) {
    const { data, error } = await supabase
      .from('sub_accounts')
      .update({
        balance: supabase.raw(`balance + ${amount}`)
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  // Resetar contadores diários
  static async resetDailyCounters() {
    const { error } = await supabase
      .from('sub_accounts')
      .update({
        daily_pix_used: 0,
        daily_pix_count: 0
      });

    if (error) throw new Error(error.message);
  }
}

// ========================================
// MODELO PIX_TRANSACTION (Transação PIX)
// ========================================

class PixTransactionModel {
  // Criar nova transação
  static async create(transactionData) {
    const { data, error } = await supabase
      .from('pix_transactions')
      .insert([{
        sub_account_id: transactionData.sub_account_id,
        user_id: transactionData.user_id,
        pix_key: transactionData.pix_key,
        pix_key_type: transactionData.pix_key_type,
        amount: transactionData.amount,
        status: 'pending',
        efi_bank_id: null,
        error_message: null,
        created_at: new Date().toISOString()
      }])
      .select();

    if (error) throw new Error(error.message);
    return data[0];
  }

  // Buscar transação por ID
  static async findById(id) {
    const { data, error } = await supabase
      .from('pix_transactions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  // Atualizar status
  static async updateStatus(id, status, efiBankId = null, errorMessage = null) {
    const updateData = {
      status,
      updated_at: new Date().toISOString()
    };

    if (efiBankId) updateData.efi_bank_id = efiBankId;
    if (errorMessage) updateData.error_message = errorMessage;

    const { data, error } = await supabase
      .from('pix_transactions')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  // Buscar transações de uma sub-conta
  static async findBySubAccountId(subAccountId, limit = 50) {
    const { data, error } = await supabase
      .from('pix_transactions')
      .select('*')
      .eq('sub_account_id', subAccountId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return data;
  }

  // Buscar transações de um usuário
  static async findByUserId(userId, limit = 50) {
    const { data, error } = await supabase
      .from('pix_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return data;
  }

  // Estatísticas de transações
  static async getStats(userId) {
    const { data, error } = await supabase
      .from('pix_transactions')
      .select('status, amount')
      .eq('user_id', userId);

    if (error) throw new Error(error.message);

    const stats = {
      total: data.length,
      pending: 0,
      completed: 0,
      failed: 0,
      total_amount: 0
    };

    data.forEach(tx => {
      stats[tx.status]++;
      if (tx.status === 'completed') {
        stats.total_amount += parseFloat(tx.amount);
      }
    });

    return stats;
  }
}

module.exports = {
  UserModel,
  SubAccountModel,
  PixTransactionModel
};
