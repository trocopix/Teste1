/*
 * Modelo User - Supabase
 * Substitui Mongoose por operações diretas no Supabase
 */

const supabase = require('../config/supabase');
const bcrypt = require('bcryptjs');

class User {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.email = data.email;
    this.password_hash = data.password_hash;
    this.company_name = data.company_name;
    this.cnpj = data.cnpj;
    this.phone = data.phone;
    this.role = data.role;
    this.is_active = data.is_active;
    this.created_at = data.created_at;
    this.last_login = data.last_login;
  }

  // Criar novo usuário
  static async create(userData) {
    try {
      // Hash da senha
      const saltRounds = 12;
      const password_hash = await bcrypt.hash(userData.password, saltRounds);

      const { data, error } = await supabase
        .from('users')
        .insert([{
          name: userData.name,
          email: userData.email,
          password_hash,
          company_name: userData.company_name,
          cnpj: userData.cnpj,
          phone: userData.phone,
          role: userData.role || 'company',
          is_active: true,
          created_at: new Date().toISOString()
        }])
        .select();

      if (error) throw new Error(error.message);
      return new User(data[0]);
    } catch (error) {
      throw new Error(`Erro ao criar usuário: ${error.message}`);
    }
  }

  // Buscar por email
  static async findByEmail(email) {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .eq('is_active', true)
        .single();

      if (error && error.code !== 'PGRST116') throw new Error(error.message);
      return data ? new User(data) : null;
    } catch (error) {
      throw new Error(`Erro ao buscar usuário: ${error.message}`);
    }
  }

  // Buscar por ID
  static async findById(id) {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (error) throw new Error(error.message);
      return data ? new User(data) : null;
    } catch (error) {
      throw new Error(`Erro ao buscar usuário: ${error.message}`);
    }
  }

  // Verificar senha
  async verifyPassword(password) {
    return await bcrypt.compare(password, this.password_hash);
  }

  // Atualizar último login
  async updateLastLogin() {
    try {
      const { error } = await supabase
        .from('users')
        .update({ last_login: new Date().toISOString() })
        .eq('id', this.id);

      if (error) throw new Error(error.message);
      this.last_login = new Date().toISOString();
    } catch (error) {
      throw new Error(`Erro ao atualizar último login: ${error.message}`);
    }
  }

  // Atualizar perfil
  async updateProfile(updateData) {
    try {
      const { data, error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', this.id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      
      // Atualizar instância
      Object.assign(this, data);
      return this;
    } catch (error) {
      throw new Error(`Erro ao atualizar perfil: ${error.message}`);
    }
  }

  // Alterar senha
  async changePassword(newPassword) {
    try {
      const saltRounds = 12;
      const password_hash = await bcrypt.hash(newPassword, saltRounds);

      const { error } = await supabase
        .from('users')
        .update({ password_hash })
        .eq('id', this.id);

      if (error) throw new Error(error.message);
      this.password_hash = password_hash;
    } catch (error) {
      throw new Error(`Erro ao alterar senha: ${error.message}`);
    }
  }

  // Desativar usuário
  async deactivate() {
    try {
      const { error } = await supabase
        .from('users')
        .update({ is_active: false })
        .eq('id', this.id);

      if (error) throw new Error(error.message);
      this.is_active = false;
    } catch (error) {
      throw new Error(`Erro ao desativar usuário: ${error.message}`);
    }
  }

  // Listar todos os usuários (admin)
  static async findAll(limit = 50) {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw new Error(error.message);
      return data.map(user => new User(user));
    } catch (error) {
      throw new Error(`Erro ao listar usuários: ${error.message}`);
    }
  }
}

module.exports = User;
