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
    
    if (!user || !user.is_active) {
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
    const subAccount = await SubAccount.findOneByUserId(user.id);

    if (!subAccount) {
      return res.status(404).json({
        success: false,
        error: 'Subconta não encontrada'
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        company_name: user.company_name,
        cnpj: user.cnpj,
        phone: user.phone,
        role: user.role,
        last_login: user.last_login,
        created_at: user.created_at
      },
      subAccount: {
        id: subAccount.id,
        name: subAccount.name,
        balance: subAccount.balance,
        max_pix_amount: subAccount.max_pix_amount,
        daily_pix_limit: subAccount.daily_pix_limit,
        daily_pix_used: subAccount.daily_pix_used,
        daily_pix_count: subAccount.daily_pix_count,
        remainingDailyLimit: subAccount.remainingDailyLimit,
        is_active: subAccount.is_active,
        created_at: subAccount.created_at
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
    const updateData = {};
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;

    await user.updateProfile(updateData);

    res.json({
      success: true,
      message: 'Perfil atualizado com sucesso',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        company_name: user.company_name,
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
    const subAccount = await SubAccount.findOneByUserId(user.id);
    if (!subAccount) {
      return res.status(404).json({
        success: false,
        error: 'Subconta não encontrada'
      });
    }

    // Buscar estatísticas das transações
    const transactionStats = await PixTransaction.getStats(user.id);

    res.json({
      success: true,
      stats: {
        subAccount: {
          balance: subAccount.balance,
          max_pix_amount: subAccount.max_pix_amount,
          daily_pix_limit: subAccount.daily_pix_limit,
          daily_pix_used: subAccount.daily_pix_used,
          daily_pix_count: subAccount.daily_pix_count,
          remainingDailyLimit: subAccount.remainingDailyLimit
        },
        transactions: transactionStats
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

    const transactions = await PixTransaction.findByUserId(user.id, parseInt(limit));
    const total = transactions.length;

    res.json({
      success: true,
      transactions: transactions.map(tx => ({
        id: tx.id,
        amount: tx.amount,
        formattedAmount: tx.formattedAmount,
        pix_key: tx.pix_key,
        pix_key_type: tx.pix_key_type,
        status: tx.status,
        statusLabel: tx.statusLabel,
        efi_transaction_id: tx.efi_transaction_id,
        error_message: tx.error_message,
        created_at: tx.created_at,
        processed_at: tx.processed_at
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

    const subAccount = await SubAccount.findOneByUserId(user.id);
    if (!subAccount) {
      return res.status(404).json({
        success: false,
        error: 'Subconta não encontrada'
      });
    }

    // Atualizar configurações se fornecidas
    const settings = {};
    if (maxPixAmount !== undefined) settings.max_pix_amount = maxPixAmount;
    if (dailyPixLimit !== undefined) settings.daily_pix_limit = dailyPixLimit;

    await subAccount.updateSettings(settings);

    res.json({
      success: true,
      message: 'Configurações atualizadas com sucesso',
      subAccount: {
        id: subAccount.id,
        name: subAccount.name,
        balance: subAccount.balance,
        max_pix_amount: subAccount.max_pix_amount,
        daily_pix_limit: subAccount.daily_pix_limit,
        daily_pix_used: subAccount.daily_pix_used,
        daily_pix_count: subAccount.daily_pix_count
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

    const subAccount = await SubAccount.findOneByUserId(user.id);
    if (!subAccount) {
      return res.status(404).json({
        success: false,
        error: 'Subconta não encontrada'
      });
    }

    await subAccount.addBalance(amount);

    res.json({
      success: true,
      message: `Saldo adicionado: R$ ${amount.toFixed(2)}`,
      subAccount: {
        id: subAccount.id,
        balance: subAccount.balance,
        max_pix_amount: subAccount.max_pix_amount
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
