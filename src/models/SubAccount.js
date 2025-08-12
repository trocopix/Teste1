const mongoose = require('mongoose');

const subAccountSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  companyName: {
    type: String,
    required: true,
    trim: true
  },
  balance: {
    type: Number,
    default: 0,
    min: [0, 'Saldo não pode ser negativo']
  },
  maxPixAmount: {
    type: Number,
    default: 99.99,
    min: [0.01, 'Valor máximo deve ser maior que 0'],
    max: [99.99, 'Valor máximo não pode exceder R$ 99,99']
  },
  dailyPixLimit: {
    type: Number,
    default: 500.00,
    min: [0, 'Limite diário não pode ser negativo']
  },
  dailyPixUsed: {
    type: Number,
    default: 0,
    min: [0, 'Valor usado não pode ser negativo']
  },
  dailyPixCount: {
    type: Number,
    default: 0,
    min: [0, 'Contador não pode ser negativo']
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastReset: {
    type: Date,
    default: Date.now
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
subAccountSchema.index({ userId: 1 });
subAccountSchema.index({ companyName: 1 });
subAccountSchema.index({ isActive: 1 });

// Virtual para saldo disponível
subAccountSchema.virtual('availableBalance').get(function() {
  return Math.max(0, this.balance);
});

// Virtual para limite diário restante
subAccountSchema.virtual('remainingDailyLimit').get(function() {
  return Math.max(0, this.dailyPixLimit - this.dailyPixUsed);
});

// Método para verificar se pode fazer PIX
subAccountSchema.methods.canMakePix = function(amount) {
  if (!this.isActive) return { can: false, reason: 'Subconta inativa' };
  if (amount > this.maxPixAmount) return { can: false, reason: 'Valor excede limite máximo por PIX' };
  if (amount > this.balance) return { can: false, reason: 'Saldo insuficiente' };
  if (this.dailyPixUsed + amount > this.dailyPixLimit) return { can: false, reason: 'Excede limite diário' };
  
  return { can: true, reason: 'OK' };
};

// Método para debitar valor
subAccountSchema.methods.debitAmount = function(amount) {
  if (amount <= 0) throw new Error('Valor deve ser maior que zero');
  
  const check = this.canMakePix(amount);
  if (!check.can) throw new Error(check.reason);
  
  this.balance -= amount;
  this.dailyPixUsed += amount;
  this.dailyPixCount += 1;
  
  return this.save();
};

// Método para creditar valor
subAccountSchema.methods.creditAmount = function(amount) {
  if (amount <= 0) throw new Error('Valor deve ser maior que zero');
  
  this.balance += amount;
  return this.save();
};

// Método para resetar contadores diários
subAccountSchema.methods.resetDailyCounters = function() {
  const now = new Date();
  const lastResetDate = new Date(this.lastReset);
  
  // Se passou um dia, reseta os contadores
  if (now.getDate() !== lastResetDate.getDate() || 
      now.getMonth() !== lastResetDate.getMonth() || 
      now.getFullYear() !== lastResetDate.getFullYear()) {
    
    this.dailyPixUsed = 0;
    this.dailyPixCount = 0;
    this.lastReset = now;
    return this.save();
  }
  
  return Promise.resolve(this);
};

// Middleware para resetar contadores antes de salvar
subAccountSchema.pre('save', async function(next) {
  await this.resetDailyCounters();
  next();
});

// Método estático para buscar subcontas ativas
subAccountSchema.statics.findActive = function() {
  return this.find({ isActive: true });
};

// Método estático para buscar por empresa
subAccountSchema.statics.findByCompany = function(companyName) {
  return this.find({ companyName: new RegExp(companyName, 'i') });
};

module.exports = mongoose.model('SubAccount', subAccountSchema);
