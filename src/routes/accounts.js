const express = require('express');
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const SubAccount = require('../models/SubAccount');
const PixTransaction = require('../models/PixTransaction');

const router = express.Router();

// Middleware de autenticação
const authenticateToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token não fornecido'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'Token inválido ou usuário inativo'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Token inválido'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expirado'
      });
    }

    console.error('Erro na autenticação:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
};

// Middleware para validar erros de validação
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array().map(err => ({
        field: err.param,
        message: err.msg
      }))
    });
  }
  next();
};

// Obter perfil do usuário
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const subAccount = await SubAccount.findOne({ userId: user._id });

    if (!subAccount) {
      return res.status(404).json({
        success: false,
        error: 'Subconta não encontrada'
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        company: user.company,
        cnpj: user.cnpj,
        phone: user.phone,
        role: user.role,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt
      },
      subAccount: {
        id: subAccount._id,
        companyName: subAccount.companyName,
        balance: subAccount.balance,
        maxPixAmount: subAccount.maxPixAmount,
        dailyPixLimit: subAccount.dailyPixLimit,
        dailyPixUsed: subAccount.dailyPixUsed,
        dailyPixCount: subAccount.dailyPixCount,
        remainingDailyLimit: subAccount.remainingDailyLimit,
        isActive: subAccount.isActive,
        lastReset: subAccount.lastReset
      }
    });

  } catch (error) {
    console.error('Erro ao obter perfil:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Atualizar perfil do usuário
router.put('/profile', [
  authenticateToken,
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Nome deve ter entre 2 e 100 caracteres'),
  body('phone')
    .optional()
    .matches(/^\(\d{2}\) \d{5}-\d{4}$/)
    .withMessage('Telefone deve estar no formato (XX) XXXXX-XXXX'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { name, phone } = req.body;
    const user = req.user;

    // Atualizar campos se fornecidos
    if (name) user.name = name;
    if (phone) user.phone = phone;

    await user.save();

    res.json({
      success: true,
      message: 'Perfil atualizado com sucesso',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        company: user.company,
        phone: user.phone,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Erro ao atualizar perfil:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Obter estatísticas da subconta
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const user = req.user;

    // Buscar subconta
    const subAccount = await SubAccount.findOne({ userId: user._id });
    if (!subAccount) {
      return res.status(404).json({
        success: false,
        error: 'Subconta não encontrada'
      });
    }

    // Buscar estatísticas das transações
    const transactionStats = await PixTransaction.getStats(
      user._id,
      startDate,
      endDate
    );

    // Calcular estatísticas adicionais
    const totalTransactions = await PixTransaction.countDocuments({ userId: user._id });
    const completedTransactions = await PixTransaction.countDocuments({ 
      userId: user._id, 
      status: 'completed' 
    });
    const failedTransactions = await PixTransaction.countDocuments({ 
      userId: user._id, 
      status: 'failed' 
    });

    // Calcular valor total processado
    const totalAmount = await PixTransaction.aggregate([
      { $match: { userId: user._id, status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    res.json({
      success: true,
      stats: {
        subAccount: {
          balance: subAccount.balance,
          maxPixAmount: subAccount.maxPixAmount,
          dailyPixLimit: subAccount.dailyPixLimit,
          dailyPixUsed: subAccount.dailyPixUsed,
          dailyPixCount: subAccount.dailyPixCount,
          remainingDailyLimit: subAccount.remainingDailyLimit
        },
        transactions: {
          total: totalTransactions,
          completed: completedTransactions,
          failed: failedTransactions,
          totalAmount: totalAmount[0]?.total || 0
        },
        byStatus: transactionStats
      }
    });

  } catch (error) {
    console.error('Erro ao obter estatísticas:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Obter histórico de transações
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const user = req.user;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = { userId: user._id };
    
    if (status) {
      query.status = status;
    }

    const transactions = await PixTransaction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('subAccountId', 'companyName');

    const total = await PixTransaction.countDocuments(query);

    res.json({
      success: true,
      transactions: transactions.map(tx => ({
        id: tx._id,
        amount: tx.amount,
        formattedAmount: tx.formattedAmount,
        pixKey: tx.pixKey,
        pixKeyType: tx.pixKeyType,
        status: tx.status,
        statusLabel: tx.statusLabel,
        efiTransactionId: tx.efiTransactionId,
        errorMessage: tx.errorMessage,
        createdAt: tx.createdAt,
        processedAt: tx.processedAt,
        subAccount: tx.subAccountId
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Erro ao obter transações:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Atualizar configurações da subconta
router.put('/subaccount', [
  authenticateToken,
  body('maxPixAmount')
    .optional()
    .isFloat({ min: 0.01, max: 99.99 })
    .withMessage('Valor máximo deve estar entre R$ 0,01 e R$ 99,99'),
  body('dailyPixLimit')
    .optional()
    .isFloat({ min: 0.01 })
    .withMessage('Limite diário deve ser maior que zero'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { maxPixAmount, dailyPixLimit } = req.body;
    const user = req.user;

    const subAccount = await SubAccount.findOne({ userId: user._id });
    if (!subAccount) {
      return res.status(404).json({
        success: false,
        error: 'Subconta não encontrada'
      });
    }

    // Atualizar configurações se fornecidas
    if (maxPixAmount !== undefined) subAccount.maxPixAmount = maxPixAmount;
    if (dailyPixLimit !== undefined) subAccount.dailyPixLimit = dailyPixLimit;

    await subAccount.save();

    res.json({
      success: true,
      message: 'Configurações atualizadas com sucesso',
      subAccount: {
        id: subAccount._id,
        companyName: subAccount.companyName,
        balance: subAccount.balance,
        maxPixAmount: subAccount.maxPixAmount,
        dailyPixLimit: subAccount.dailyPixLimit,
        dailyPixUsed: subAccount.dailyPixUsed,
        dailyPixCount: subAccount.dailyPixCount
      }
    });

  } catch (error) {
    console.error('Erro ao atualizar configurações:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Adicionar saldo à subconta (apenas para testes/admin)
router.post('/add-balance', [
  authenticateToken,
  body('amount')
    .isFloat({ min: 0.01 })
    .withMessage('Valor deve ser maior que zero'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { amount } = req.body;
    const user = req.user;

    // Verificar se é admin (em produção, remover esta rota ou adicionar mais validações)
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado'
      });
    }

    const subAccount = await SubAccount.findOne({ userId: user._id });
    if (!subAccount) {
      return res.status(404).json({
        success: false,
        error: 'Subconta não encontrada'
      });
    }

    await subAccount.creditAmount(amount);

    res.json({
      success: true,
      message: `Saldo adicionado: R$ ${amount.toFixed(2)}`,
      subAccount: {
        id: subAccount._id,
        balance: subAccount.balance,
        maxPixAmount: subAccount.maxPixAmount
      }
    });

  } catch (error) {
    console.error('Erro ao adicionar saldo:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

module.exports = router;
