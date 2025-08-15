const express = require('express');
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const SubAccount = require('../models/SubAccount');
const PixTransaction = require('../models/PixTransaction');
const efiBankService = require('../services/efiBankService');

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

// Calcular troco
router.post('/calculate', [
  authenticateToken,
  body('totalAmount')
    .isFloat({ min: 0.01 })
    .withMessage('Valor total deve ser maior que zero'),
  body('paidAmount')
    .isFloat({ min: 0.01 })
    .withMessage('Valor pago deve ser maior que zero'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { totalAmount, paidAmount } = req.body;
    const user = req.user;

    // Calcular troco
    const change = paidAmount - totalAmount;

    if (change < 0) {
      return res.status(400).json({
        success: false,
        error: 'Valor pago é menor que o valor total'
      });
    }

    if (change === 0) {
      return res.json({
        success: true,
        message: 'Não há troco a ser devolvido',
        change: 0,
        formattedChange: 'R$ 0,00'
      });
    }

    // Verificar se o troco está dentro do limite
    if (change > 99.99) {
      return res.status(400).json({
        success: false,
        error: 'Troco excede o limite máximo de R$ 99,99',
        change,
        formattedChange: `R$ ${change.toFixed(2).replace('.', ',')}`
      });
    }

    // Buscar subconta
    const subAccount = await SubAccount.findOne({ userId: user._id });
    if (!subAccount) {
      return res.status(404).json({
        success: false,
        error: 'Subconta não encontrada'
      });
    }

    // Verificar se pode fazer PIX
    const canMakePix = subAccount.canMakePix(change);
    if (!canMakePix.can) {
      return res.status(400).json({
        success: false,
        error: canMakePix.reason,
        change,
        formattedChange: `R$ ${change.toFixed(2).replace('.', ',')}`
      });
    }

    res.json({
      success: true,
      message: 'Troco calculado com sucesso',
      change,
      formattedChange: `R$ ${change.toFixed(2).replace('.', ',')}`,
      canProcessPix: true,
      subAccount: {
        balance: subAccount.balance,
        maxPixAmount: subAccount.maxPixAmount,
        dailyPixLimit: subAccount.dailyPixLimit,
        dailyPixUsed: subAccount.dailyPixUsed,
        remainingDailyLimit: subAccount.remainingDailyLimit
      }
    });

  } catch (error) {
    console.error('Erro ao calcular troco:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Processar troco via PIX
router.post('/process', [
  authenticateToken,
  body('changeAmount')
    .isFloat({ min: 0.01, max: 99.99 })
    .withMessage('Valor do troco deve estar entre R$ 0,01 e R$ 99,99'),
  body('pixKey')
    .notEmpty()
    .withMessage('Chave PIX é obrigatória'),
  body('customerName')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Nome do cliente deve ter no máximo 100 caracteres'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { changeAmount, pixKey, customerName } = req.body;
    const user = req.user;

    // Buscar subconta
    const subAccount = await SubAccount.findOne({ userId: user._id });
    if (!subAccount) {
      return res.status(404).json({
        success: false,
        error: 'Subconta não encontrada'
      });
    }

    // Verificar se pode fazer PIX
    const canMakePix = subAccount.canMakePix(changeAmount);
    if (!canMakePix.can) {
      return res.status(400).json({
        success: false,
        error: canMakePix.reason
      });
    }

    // Detectar tipo de chave PIX
    const pixKeyType = efiBankService.detectPixKeyType(pixKey);
    if (!pixKeyType) {
      return res.status(400).json({
        success: false,
        error: 'Formato de chave PIX inválido'
      });
    }

    // Validar chave PIX
    const validation = efiBankService.validatePixKey(pixKey, pixKeyType);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }

    // Criar transação no banco
    const pixTransaction = new PixTransaction({
      subAccountId: subAccount._id,
      userId: user._id,
      pixKey,
      pixKeyType,
      amount: changeAmount,
      status: 'pending'
    });

    await pixTransaction.save();

    // Tentar processar PIX via EFI Bank
    try {
      const pixResult = await efiBankService.makePix({
        pixKey,
        amount: changeAmount,
        description: `Troco automático - ${user.company}${customerName ? ` - ${customerName}` : ''}`,
        debtorName: user.name,
        debtorCpf: user.cnpj ? null : '00000000000',
        debtorCnpj: user.cnpj || null
      });

      if (pixResult.success) {
        // Marcar como processando
        await pixTransaction.markAsProcessing();

        // Debitar valor da subconta
        await subAccount.debitAmount(changeAmount);

        // Marcar como concluído
        await pixTransaction.markAsCompleted(
          pixResult.transactionId,
          pixResult.response
        );

        res.json({
          success: true,
          message: 'Troco enviado com sucesso via PIX',
          transaction: {
            id: pixTransaction._id,
            amount: pixTransaction.amount,
            formattedAmount: pixTransaction.formattedAmount,
            pixKey: pixTransaction.pixKey,
            status: pixTransaction.status,
            statusLabel: pixTransaction.statusLabel,
            efiTransactionId: pixTransaction.efiTransactionId,
            createdAt: pixTransaction.createdAt
          },
          efiResponse: {
            transactionId: pixResult.transactionId,
            qrCode: pixResult.qrCode,
            qrCodeImage: pixResult.qrCodeImage
          },
          subAccount: {
            balance: subAccount.balance,
            dailyPixUsed: subAccount.dailyPixUsed,
            dailyPixCount: subAccount.dailyPixCount
          }
        });

      } else {
        // Marcar como falhou
        await pixTransaction.markAsFailed(pixResult.error);

        res.status(400).json({
          success: false,
          error: `Falha ao enviar troco: ${pixResult.error}`,
          transaction: {
            id: pixTransaction._id,
            status: pixTransaction.status,
            errorMessage: pixTransaction.errorMessage
          }
        });
      }

    } catch (efiError) {
      console.error('Erro na API EFI Bank:', efiError);
      
      // Marcar como falhou
      await pixTransaction.markAsFailed(efiError.message);

      res.status(500).json({
        success: false,
        error: 'Erro na comunicação com o banco',
        transaction: {
          id: pixTransaction._id,
          status: pixTransaction.status,
          errorMessage: pixTransaction.errorMessage
        }
      });
    }

  } catch (error) {
    console.error('Erro ao processar troco:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Obter histórico de trocos
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, startDate, endDate } = req.query;
    const user = req.user;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = { 
      userId: user._id,
      status: { $in: ['completed', 'failed', 'cancelled'] }
    };
    
    // Filtrar por data se fornecida
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const transactions = await PixTransaction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('subAccountId', 'companyName');

    const total = await PixTransaction.countDocuments(query);

    // Calcular estatísticas
    const totalChange = await PixTransaction.aggregate([
      { $match: { ...query, status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const totalAmount = totalChange[0]?.total || 0;

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
      stats: {
        totalTransactions: total,
        totalAmount,
        formattedTotalAmount: `R$ ${totalAmount.toFixed(2).replace('.', ',')}`
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Erro ao obter histórico:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Obter estatísticas de troco
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

    // Construir query base
    const baseQuery = { userId: user._id };
    if (startDate && endDate) {
      baseQuery.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Estatísticas por status
    const statusStats = await PixTransaction.aggregate([
      { $match: baseQuery },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    // Total de trocos enviados
    const totalChangeSent = await PixTransaction.aggregate([
      { $match: { ...baseQuery, status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    // Média de troco
    const avgChange = await PixTransaction.aggregate([
      { $match: { ...baseQuery, status: 'completed' } },
      { $group: { _id: null, average: { $avg: '$amount' } } }
    ]);

    // Maior e menor troco
    const changeRange = await PixTransaction.aggregate([
      { $match: { ...baseQuery, status: 'completed' } },
      {
        $group: {
          _id: null,
          minAmount: { $min: '$amount' },
          maxAmount: { $max: '$amount' }
        }
      }
    ]);

    res.json({
      success: true,
      stats: {
        subAccount: {
          balance: subAccount.balance,
          maxPixAmount: subAccount.maxPixAmount,
          dailyPixLimit: subAccount.dailyPixLimit,
          dailyPixUsed: subAccount.dailyPixUsed,
          remainingDailyLimit: subAccount.remainingDailyLimit
        },
        change: {
          totalSent: totalChangeSent[0]?.total || 0,
          formattedTotalSent: `R$ ${(totalChangeSent[0]?.total || 0).toFixed(2).replace('.', ',')}`,
          average: avgChange[0]?.average || 0,
          formattedAverage: `R$ ${(avgChange[0]?.average || 0).toFixed(2).replace('.', ',')}`,
          minAmount: changeRange[0]?.minAmount || 0,
          formattedMinAmount: `R$ ${(changeRange[0]?.minAmount || 0).toFixed(2).replace('.', ',')}`,
          maxAmount: changeRange[0]?.maxAmount || 0,
          formattedMaxAmount: `R$ ${(changeRange[0]?.maxAmount || 0).toFixed(2).replace('.', ',')}`
        },
        byStatus: statusStats
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

// ❌ REMOVIDO: Endpoint /simulate confuso e duplicado
// O Arduino agora usa diretamente /api/arduino/process-troco

module.exports = router;
