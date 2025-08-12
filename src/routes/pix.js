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

// Processar PIX
router.post('/process', [
  authenticateToken,
  body('pixKey')
    .notEmpty()
    .withMessage('Chave PIX é obrigatória'),
  body('amount')
    .isFloat({ min: 0.01, max: 99.99 })
    .withMessage('Valor deve estar entre R$ 0,01 e R$ 99,99'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Descrição deve ter no máximo 200 caracteres'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { pixKey, amount, description } = req.body;
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
    const canMakePix = subAccount.canMakePix(amount);
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
      amount,
      status: 'pending'
    });

    await pixTransaction.save();

    // Tentar processar PIX via EFI Bank
    try {
      const pixResult = await efiBankService.makePix({
        pixKey,
        amount,
        description: description || `Troco automático - ${user.company}`,
        debtorName: user.name,
        debtorCpf: user.cnpj ? null : '00000000000',
        debtorCnpj: user.cnpj || null
      });

      if (pixResult.success) {
        // Marcar como processando
        await pixTransaction.markAsProcessing();

        // Debitar valor da subconta
        await subAccount.debitAmount(amount);

        // Marcar como concluído
        await pixTransaction.markAsCompleted(
          pixResult.transactionId,
          pixResult.response
        );

        res.json({
          success: true,
          message: 'PIX processado com sucesso',
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
          error: `Falha ao processar PIX: ${pixResult.error}`,
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
    console.error('Erro ao processar PIX:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Consultar status de uma transação
router.get('/status/:transactionId', authenticateToken, async (req, res) => {
  try {
    const { transactionId } = req.params;
    const user = req.user;

    // Buscar transação
    const pixTransaction = await PixTransaction.findOne({
      _id: transactionId,
      userId: user._id
    });

    if (!pixTransaction) {
      return res.status(404).json({
        success: false,
        error: 'Transação não encontrada'
      });
    }

    // Se a transação foi processada via EFI Bank, consultar status atual
    if (pixTransaction.efiTransactionId && pixTransaction.status === 'processing') {
      try {
        const efiStatus = await efiBankService.checkPixStatus(pixTransaction.efiTransactionId);
        
        if (efiStatus.success) {
          // Atualizar status se necessário
          if (efiStatus.status === 'CONCLUIDA' && pixTransaction.status !== 'completed') {
            await pixTransaction.markAsCompleted(
              pixTransaction.efiTransactionId,
              efiStatus.response
            );
          } else if (efiStatus.status === 'REMOVIDA_PELO_USUARIO_RECEBEDOR' && pixTransaction.status !== 'cancelled') {
            await pixTransaction.markAsCancelled();
          }
        }
      } catch (efiError) {
        console.error('Erro ao consultar status EFI Bank:', efiError);
        // Continuar com o status local
      }
    }

    res.json({
      success: true,
      transaction: {
        id: pixTransaction._id,
        amount: pixTransaction.amount,
        formattedAmount: pixTransaction.formattedAmount,
        pixKey: pixTransaction.pixKey,
        pixKeyType: pixTransaction.pixKeyType,
        status: pixTransaction.status,
        statusLabel: pixTransaction.statusLabel,
        efiTransactionId: pixTransaction.efiTransactionId,
        errorMessage: pixTransaction.errorMessage,
        retryCount: pixTransaction.retryCount,
        createdAt: pixTransaction.createdAt,
        processedAt: pixTransaction.processedAt
      }
    });

  } catch (error) {
    console.error('Erro ao consultar status:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Cancelar PIX
router.delete('/cancel/:transactionId', [
  authenticateToken,
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Motivo deve ter no máximo 200 caracteres'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { reason } = req.body;
    const user = req.user;

    // Buscar transação
    const pixTransaction = await PixTransaction.findOne({
      _id: transactionId,
      userId: user._id
    });

    if (!pixTransaction) {
      return res.status(404).json({
        success: false,
        error: 'Transação não encontrada'
      });
    }

    // Verificar se pode ser cancelada
    if (pixTransaction.status === 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Transação já foi concluída e não pode ser cancelada'
      });
    }

    if (pixTransaction.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        error: 'Transação já foi cancelada'
      });
    }

    // Se foi processada via EFI Bank, tentar cancelar
    if (pixTransaction.efiTransactionId) {
      try {
        const cancelResult = await efiBankService.cancelPix(
          pixTransaction.efiTransactionId,
          reason || 'Cancelamento solicitado pelo usuário'
        );

        if (cancelResult.success) {
          // Marcar como cancelada
          await pixTransaction.markAsCancelled();

          // Se ainda não foi debitada, não precisa fazer nada
          // Se foi debitada, reembolsar (implementar lógica de reembolso se necessário)

          res.json({
            success: true,
            message: 'PIX cancelado com sucesso',
            transaction: {
              id: pixTransaction._id,
              status: pixTransaction.status,
              statusLabel: pixTransaction.statusLabel
            }
          });
        } else {
          res.status(400).json({
            success: false,
            error: `Falha ao cancelar PIX: ${cancelResult.error}`
          });
        }
      } catch (efiError) {
        console.error('Erro ao cancelar PIX via EFI Bank:', efiError);
        
        // Marcar como cancelada localmente mesmo com erro na API
        await pixTransaction.markAsCancelled();

        res.json({
          success: true,
          message: 'PIX cancelado localmente',
          warning: 'Erro na comunicação com o banco',
          transaction: {
            id: pixTransaction._id,
            status: pixTransaction.status,
            statusLabel: pixTransaction.statusLabel
          }
        });
      }
    } else {
      // Transação apenas local, cancelar diretamente
      await pixTransaction.markAsCancelled();

      res.json({
        success: true,
        message: 'PIX cancelado com sucesso',
        transaction: {
          id: pixTransaction._id,
          status: pixTransaction.status,
          statusLabel: pixTransaction.statusLabel
        }
      });
    }

  } catch (error) {
    console.error('Erro ao cancelar PIX:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Reprocessar PIX falhado
router.post('/retry/:transactionId', authenticateToken, async (req, res) => {
  try {
    const { transactionId } = req.params;
    const user = req.user;

    // Buscar transação
    const pixTransaction = await PixTransaction.findOne({
      _id: transactionId,
      userId: user._id
    });

    if (!pixTransaction) {
      return res.status(404).json({
        success: false,
        error: 'Transação não encontrada'
      });
    }

    // Verificar se pode ser reprocessada
    if (!pixTransaction.canRetry()) {
      return res.status(400).json({
        success: false,
        error: 'Transação não pode ser reprocessada'
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

    // Verificar se ainda pode fazer PIX
    const canMakePix = subAccount.canMakePix(pixTransaction.amount);
    if (!canMakePix.can) {
      return res.status(400).json({
        success: false,
        error: canMakePix.reason
      });
    }

    // Resetar status para tentar novamente
    pixTransaction.status = 'pending';
    pixTransaction.errorMessage = null;
    await pixTransaction.save();

    // Tentar processar novamente
    try {
      const pixResult = await efiBankService.makePix({
        pixKey: pixTransaction.pixKey,
        amount: pixTransaction.amount,
        description: `Retry - Troco automático - ${user.company}`,
        debtorName: user.name,
        debtorCpf: user.cnpj ? null : '00000000000',
        debtorCnpj: user.cnpj || null
      });

      if (pixResult.success) {
        // Marcar como processando
        await pixTransaction.markAsProcessing();

        // Debitar valor da subconta
        await subAccount.debitAmount(pixTransaction.amount);

        // Marcar como concluído
        await pixTransaction.markAsCompleted(
          pixResult.transactionId,
          pixResult.response
        );

        res.json({
          success: true,
          message: 'PIX reprocessado com sucesso',
          transaction: {
            id: pixTransaction._id,
            amount: pixTransaction.amount,
            formattedAmount: pixTransaction.formattedAmount,
            status: pixTransaction.status,
            statusLabel: pixTransaction.statusLabel,
            efiTransactionId: pixTransaction.efiTransactionId
          }
        });

      } else {
        // Marcar como falhou novamente
        await pixTransaction.markAsFailed(pixResult.error);

        res.status(400).json({
          success: false,
          error: `Falha ao reprocessar PIX: ${pixResult.error}`,
          transaction: {
            id: pixTransaction._id,
            status: pixTransaction.status,
            errorMessage: pixTransaction.errorMessage,
            retryCount: pixTransaction.retryCount
          }
        });
      }

    } catch (efiError) {
      console.error('Erro na API EFI Bank (retry):', efiError);
      
      // Marcar como falhou
      await pixTransaction.markAsFailed(efiError.message);

      res.status(500).json({
        success: false,
        error: 'Erro na comunicação com o banco',
        transaction: {
          id: pixTransaction._id,
          status: pixTransaction.status,
          errorMessage: pixTransaction.errorMessage,
          retryCount: pixTransaction.retryCount
        }
      });
    }

  } catch (error) {
    console.error('Erro ao reprocessar PIX:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

module.exports = router;
