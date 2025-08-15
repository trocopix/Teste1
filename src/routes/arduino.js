const express = require('express');
const { body, validationResult } = require('express-validator');
const Establishment = require('../models/Establishment');
const SubAccount = require('../models/SubAccount');
const PixTransaction = require('../models/PixTransaction');
const efiBankService = require('../services/efiBankService');

const router = express.Router();

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

// Processar troco via Arduino (sem autenticação JWT)
router.post('/process-troco', [
  body('establishment_id')
    .notEmpty()
    .withMessage('ID do estabelecimento é obrigatório'),
  body('changeAmount')
    .isFloat({ min: 0.01, max: 99.99 })
    .withMessage('Valor do troco deve estar entre R$ 0,01 e R$ 99,99'),
  body('pixKey')
    .notEmpty()
    .withMessage('Chave PIX é obrigatória'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { establishment_id, changeAmount, pixKey } = req.body;

    // Buscar estabelecimento
    const establishment = await Establishment.findByEstablishmentId(establishment_id);
    
    if (!establishment || !establishment.is_active) {
      return res.status(404).json({
        success: false,
        error: 'Estabelecimento não encontrado ou inativo'
      });
    }

    // Buscar subconta
    const subAccount = await SubAccount.findById(establishment.sub_account_id);
    if (!subAccount || !subAccount.is_active) {
      return res.status(400).json({
        success: false,
        error: 'Subconta não encontrada ou inativa'
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
    const pixTransaction = await PixTransaction.create({
      sub_account_id: subAccount.id,
      user_id: establishment.user_id,
      pix_key: pixKey,
      pix_key_type: pixKeyType,
      amount: changeAmount,
      status: 'pending',
      source: 'arduino'
    });

    // Tentar processar PIX via EFI Bank
    try {
      const pixResult = await efiBankService.makePix({
        pixKey,
        amount: changeAmount,
        description: `Troco automático - ${establishment.name}`,
        debtorName: establishment.name,
        debtorCpf: null, // CPF não está no modelo Establishment
        debtorCnpj: establishment.cnpj || null
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

        // Atualizar último acesso do Arduino
        await establishment.configureArduino({
          ...establishment.arduino_config,
          lastSeen: new Date()
        });

        res.json({
          success: true,
          message: 'Troco enviado com sucesso via PIX',
          transaction: {
            id: pixTransaction.id,
            amount: pixTransaction.amount,
            formattedAmount: pixTransaction.formattedAmount,
            status: pixTransaction.status,
            efiTransactionId: pixTransaction.efi_bank_id
          },
          subAccount: {
            balance: subAccount.balance,
            dailyPixUsed: subAccount.daily_pix_used
          }
        });

      } else {
        // Marcar como falhou
        await pixTransaction.markAsFailed(pixResult.error);

        res.status(400).json({
          success: false,
          error: `Falha ao enviar troco: ${pixResult.error}`,
          transaction: {
            id: pixTransaction.id,
            status: pixTransaction.status,
            errorMessage: pixTransaction.error_message
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
          id: pixTransaction.id,
          status: pixTransaction.status,
          errorMessage: pixTransaction.error_message
        }
      });
    }

  } catch (error) {
    console.error('Erro ao processar troco via Arduino:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Verificar status do estabelecimento
router.get('/status/:establishment_id', async (req, res) => {
  try {
    const { establishment_id } = req.params;

    const establishment = await Establishment.findByEstablishmentId(establishment_id);
    
    if (!establishment || !establishment.is_active) {
      return res.status(404).json({
        success: false,
        error: 'Estabelecimento não encontrado ou inativo'
      });
    }

    const subAccount = await SubAccount.findById(establishment.sub_account_id);
    if (!subAccount) {
      return res.status(404).json({
        success: false,
        error: 'Subconta não encontrada'
      });
    }

    res.json({
      success: true,
      establishment: {
        id: establishment.id,
        establishment_id: establishment.establishment_id,
        name: establishment.name,
        isActive: establishment.is_active
      },
      subAccount: {
        balance: subAccount.balance,
        max_pix_amount: subAccount.max_pix_amount,
        daily_pix_limit: subAccount.daily_pix_limit,
        daily_pix_used: subAccount.daily_pix_used,
        remainingDailyLimit: subAccount.remainingDailyLimit
      }
    });

  } catch (error) {
    console.error('Erro ao verificar status:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Heartbeat do Arduino
router.post('/heartbeat/:establishment_id', async (req, res) => {
  try {
    const { establishment_id } = req.params;

    const establishment = await Establishment.findByEstablishmentId(establishment_id);
    
    if (!establishment || !establishment.is_active) {
      return res.status(404).json({
        success: false,
        error: 'Estabelecimento não encontrado ou inativo'
      });
    }

    // Atualizar último acesso
    await establishment.configureArduino({
      ...establishment.arduino_config,
      lastSeen: new Date()
    });

    res.json({
      success: true,
      message: 'Heartbeat registrado',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erro no heartbeat:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

module.exports = router;
