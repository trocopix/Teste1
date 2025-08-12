const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Nome é obrigatório'],
    trim: true,
    maxlength: [100, 'Nome não pode ter mais de 100 caracteres']
  },
  email: {
    type: String,
    required: [true, 'Email é obrigatório'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Email inválido']
  },
  password: {
    type: String,
    required: [true, 'Senha é obrigatória'],
    minlength: [6, 'Senha deve ter pelo menos 6 caracteres']
  },
  company: {
    type: String,
    required: [true, 'Nome da empresa é obrigatório'],
    trim: true
  },
  cnpj: {
    type: String,
    required: [true, 'CNPJ é obrigatório'],
    unique: true,
    match: [/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, 'CNPJ inválido']
  },
  phone: {
    type: String,
    required: [true, 'Telefone é obrigatório'],
    match: [/^\(\d{2}\) \d{5}-\d{4}$/, 'Telefone inválido']
  },
  role: {
    type: String,
    enum: ['admin', 'company', 'user'],
    default: 'company'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Índices para performance
userSchema.index({ email: 1 });
userSchema.index({ cnpj: 1 });
userSchema.index({ company: 1 });

// Hash da senha antes de salvar
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Método para comparar senhas
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Método para atualizar último login
userSchema.methods.updateLastLogin = function() {
  this.lastLogin = new Date();
  return this.save();
};

// Virtual para nome completo
userSchema.virtual('fullName').get(function() {
  return `${this.name} - ${this.company}`;
});

// Método estático para buscar por empresa
userSchema.statics.findByCompany = function(companyName) {
  return this.find({ company: new RegExp(companyName, 'i') });
};

module.exports = mongoose.model('User', userSchema);
