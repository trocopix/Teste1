/*
 * Modelo Establishment - Supabase
 * Substitui Mongoose por operações diretas no Supabase
 */

const supabase = require('../config/supabase');
const { v4: uuidv4 } = require('uuid');

class Establishment {
  constructor(data) {
    this.id = data.id;
    this.establishment_id = data.establishment_id;
    this.user_id = data.user_id;
    this.name = data.name;
    this.sub_account_id = data.sub_account_id;
    this.cnpj = data.cnpj;
    this.address = data.address;
    this.phone = data.phone;
    this.is_active = data.is_active;
    this.arduino_config = data.arduino_config;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  // Criar novo estabelecimento
  static async create(establishmentData) {
    try {
      // Gerar ID único para Arduino
      const establishment_id = uuidv4().substring(0, 8).toUpperCase();

      const { data, error } = await supabase
        .from('establishments')
        .insert([{
          establishment_id,
          user_id: establishmentData.user_id,
          name: establishmentData.name,
          sub_account_id: establishmentData.sub_account_id,
          cnpj: establishmentData.cnpj,
          address: establishmentData.address,
          phone: establishmentData.phone,
          is_active: true,
          arduino_config: establishmentData.arduino_config || {},
          created_at: new Date().toISOString()
        }])
        .select();

      if (error) throw new Error(error.message);
      return new Establishment(data[0]);
    } catch (error) {
      throw new Error(`Erro ao criar estabelecimento: ${error.message}`);
    }
  }

  // Buscar por ID
  static async findById(id) {
    try {
      const { data, error } = await supabase
        .from('establishments')
        .select('*')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (error) throw new Error(error.message);
      return data ? new Establishment(data) : null;
    } catch (error) {
      throw new Error(`Erro ao buscar estabelecimento: ${error.message}`);
    }
  }

  // Buscar por establishment_id (para Arduino)
  static async findByEstablishmentId(establishmentId) {
    try {
      const { data, error } = await supabase
        .from('establishments')
        .select('*')
        .eq('establishment_id', establishmentId)
        .eq('is_active', true)
        .single();

      if (error) throw new Error(error.message);
      return data ? new Establishment(data) : null;
    } catch (error) {
      throw new Error(`Erro ao buscar estabelecimento: ${error.message}`);
    }
  }

  // Buscar por usuário
  static async findByUserId(userId) {
    try {
      const { data, error } = await supabase
        .from('establishments')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw new Error(error.message);
      return data.map(est => new Establishment(est));
    } catch (error) {
      throw new Error(`Erro ao buscar estabelecimentos: ${error.message}`);
    }
  }

  // Listar todos os estabelecimentos
  static async findAll(limit = 50) {
    try {
      const { data, error } = await supabase
        .from('establishments')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw new Error(error.message);
      return data.map(est => new Establishment(est));
    } catch (error) {
      throw new Error(`Erro ao listar estabelecimentos: ${error.message}`);
    }
  }

  // Atualizar estabelecimento
  async update(updateData) {
    try {
      const { data, error } = await supabase
        .from('establishments')
        .update({
          ...updateData,
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
      throw new Error(`Erro ao atualizar estabelecimento: ${error.message}`);
    }
  }

  // Ativar/desativar estabelecimento
  async toggle() {
    try {
      const { data, error } = await supabase
        .from('establishments')
        .update({
          is_active: !this.is_active,
          updated_at: new Date().toISOString()
        })
        .eq('id', this.id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      
      this.is_active = data.is_active;
      this.updated_at = data.updated_at;
      
      return this;
    } catch (error) {
      throw new Error(`Erro ao alterar status do estabelecimento: ${error.message}`);
    }
  }

  // Configurar Arduino
  async configureArduino(arduinoConfig) {
    try {
      const { data, error } = await supabase
        .from('establishments')
        .update({
          arduino_config: arduinoConfig,
          updated_at: new Date().toISOString()
        })
        .eq('id', this.id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      
      this.arduino_config = data.arduino_config;
      this.updated_at = data.updated_at;
      
      return this;
    } catch (error) {
      throw new Error(`Erro ao configurar Arduino: ${error.message}`);
    }
  }

  // Deletar estabelecimento (soft delete)
  async delete() {
    try {
      const { error } = await supabase
        .from('establishments')
        .update({
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', this.id);

      if (error) throw new Error(error.message);
      this.is_active = false;
    } catch (error) {
      throw new Error(`Erro ao deletar estabelecimento: ${error.message}`);
    }
  }

  // Verificar se estabelecimento está ativo
  get isActive() {
    return this.is_active;
  }

  // Obter configuração do Arduino
  get arduinoConfiguration() {
    return this.arduino_config || {};
  }
}

module.exports = Establishment;
