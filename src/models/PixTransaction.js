const mongoose = require('mongoose');

const pixTransactionSchema = new mongoose.Schema({
  subAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SubAccount',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  pixKey: {
    type: String,
    required: [true, 'Chave PIX é obrigatória'],
    trim: true
  },
  pixKeyType: {
    type: String,
    enum: ['cpf', 'cnpj', 'email', 'phone', 'random'],
    required: true
  },
  amount: {
    type: Number,
    required: [true, 'Valor é obrigatório'],
    min: [0.01, 'Valor deve ser maior que zero'],
    max: [99.99, 'Valor não pode exceder R$ 99,99']
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  efiTransactionId: {
    type: String,
    sparse: true
  },
  efiResponse: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  errorMessage: {
    type: String,
    default: null
  },
  retryCount: {
    type: Number,
    default: 0,
    max: [3, 'Máximo de 3 tentativas']
  },
  processedAt: {
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
pixTransactionSchema.index({ subAccountId: 1 });
pixTransactionSchema.index({ userId: 1 });
pixTransactionSchema.index({ status: 1 });
pixTransactionSchema.index({ createdAt: -1 });
pixTransactionSchema.index({ efiTransactionId: 1 });

// Virtual para status em português
pixTransactionSchema.virtual('statusLabel').get(function() {
  const statusMap = {
    pending: 'Pendente',
    processing: 'Processando',
    completed: 'Concluído',
    failed: 'Falhou',
    cancelled: 'Cancelado'
  };
  return statusMap[this.status] || this.status;
});

// Virtual para valor formatado
pixTransactionSchema.virtual('formattedAmount').get(function() {
  return `R$ ${this.amount.toFixed(2).replace('.', ',')}`;
});

// Método para marcar como processando
pixTransactionSchema.methods.markAsProcessing = function() {
  this.status = 'processing';
  return this.save();
};

// Método para marcar como concluído
pixTransactionSchema.methods.markAsCompleted = function(efiTransactionId, efiResponse) {
  this.status = 'completed';
  this.efiTransactionId = efiTransactionId;
  this.efiResponse = efiResponse;
  this.processedAt = new Date();
  return this.save();
};

// Método para marcar como falhou
pixTransactionSchema.methods.markAsFailed = function(errorMessage) {
  this.status = 'failed';
  this.errorMessage = errorMessage;
  this.retryCount += 1;
  return this.save();
};

// Método para marcar como cancelado
pixTransactionSchema.methods.markAsCancelled = function() {
  this.status = 'cancelled';
  return this.save();
};

// Método para verificar se pode ser reprocessado
pixTransactionSchema.methods.canRetry = function() {
  return this.status === 'failed' && this.retryCount < 3;
};

// Método estático para buscar transações pendentes
pixTransactionSchema.statics.findPending = function() {
  return this.find({ status: 'pending' });
};

// Método estático para buscar transações por status
pixTransactionSchema.statics.findByStatus = function(status) {
  return this.find({ status });
};

// Método estático para buscar transações por usuário
pixTransactionSchema.statics.findByUser = function(userId, limit = 50) {
  return this.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit);
};

// Método estático para buscar transações por subconta
pixTransactionSchema.statics.findBySubAccount = function(subAccountId, limit = 50) {
  return this.find({ subAccountId })
    .sort({ createdAt: -1 })
    .limit(limit);
};

// Método estático para estatísticas
pixTransactionSchema.statics.getStats = async function(userId, startDate, endDate) {
  const match = { userId };
  
  if (startDate && endDate) {
    match.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  return await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' }
      }
    }
  ]);
};

module.exports = mongoose.model('PixTransaction', pixTransactionSchema);
