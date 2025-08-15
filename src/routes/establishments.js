const express = require('express');
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Establishment = require('../models/Establishment');
const SubAccount = require('../models/SubAccount');

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

// Criar novo estabelecimento
router.post('/', [
  authenticateToken,
  body('name')
    .notEmpty()
    .withMessage('Nome do estabelecimento é obrigatório')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Nome deve ter entre 2 e 100 caracteres'),
  body('cnpj')
    .notEmpty()
    .withMessage('CNPJ é obrigatório')
    .matches(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/)
    .withMessage('CNPJ inválido'),
  body('phone')
    .notEmpty()
    .withMessage('Telefone é obrigatório')
    .matches(/^\(\d{2}\) \d{5}-\d{4}$/)
    .withMessage('Telefone inválido'),
  body('address')
    .optional()
    .isObject()
    .withMessage('Endereço deve ser um objeto'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { name, cnpj, phone, address, settings } = req.body;
    const user = req.user;

    // Verificar se já existe subconta para o usuário
    let subAccount = await SubAccount.findOneByUserId(user.id);
    
    if (!subAccount) {
      // Criar subconta se não existir
      subAccount = await SubAccount.create({
        user_id: user.id,
        name: user.company_name,
        balance: 0,
        max_pix_amount: 99.99,
        daily_pix_limit: 500.00
      });
    }

    // Criar estabelecimento
    const establishment = await Establishment.create({
      userId: user.id,
      name,
      cnpj,
      phone,
      address,
      subAccountId: subAccount.id,
      settings: settings || {}
    });

    res.status(201).json({
      success: true,
      message: 'Estabelecimento criado com sucesso',
      establishment: {
        id: establishment.id,
        name: establishment.name,
        cnpj: establishment.cnpj,
        phone: establishment.phone,
        isActive: establishment.isActive,
        arduinoConfiguration: establishment.arduinoConfiguration,
        settings: establishment.settings,
        created_at: establishment.created_at
      }
    });

  } catch (error) {
    console.error('Erro ao criar estabelecimento:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Listar estabelecimentos do usuário
router.get('/', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const establishments = await Establishment.findByUserId(user.id);

    res.json({
      success: true,
      establishments: establishments.map(est => ({
        id: est.id,
        name: est.name,
        cnpj: est.cnpj,
        phone: est.phone,
        address: est.address,
        isActive: est.isActive,
        arduinoConfiguration: est.arduinoConfiguration,
        settings: est.settings,
        created_at: est.created_at,
        updated_at: est.updated_at
      }))
    });

  } catch (error) {
    console.error('Erro ao listar estabelecimentos:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Obter estabelecimento específico
router.get('/:establishmentId', authenticateToken, async (req, res) => {
  try {
    const { establishmentId } = req.params;
    const user = req.user;

    const establishment = await Establishment.findByEstablishmentId(establishmentId);
    
    if (establishment && establishment.userId !== user.id) {
      return res.status(404).json({
        success: false,
        error: 'Estabelecimento não encontrado'
      });
    }

    if (!establishment) {
      return res.status(404).json({
        success: false,
        error: 'Estabelecimento não encontrado'
      });
    }

    res.json({
      success: true,
      establishment: {
        id: establishment.id,
        name: establishment.name,
        cnpj: establishment.cnpj,
        phone: establishment.phone,
        address: establishment.address,
        isActive: establishment.isActive,
        arduinoConfiguration: establishment.arduinoConfiguration,
        settings: establishment.settings,
        created_at: establishment.created_at,
        updated_at: establishment.updated_at
      }
    });

  } catch (error) {
    console.error('Erro ao obter estabelecimento:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Atualizar estabelecimento
router.put('/:establishmentId', [
  authenticateToken,
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Nome deve ter entre 2 e 100 caracteres'),
  body('phone')
    .optional()
    .matches(/^\(\d{2}\) \d{5}-\d{4}$/)
    .withMessage('Telefone inválido'),
  body('address')
    .optional()
    .isObject()
    .withMessage('Endereço deve ser um objeto'),
  body('settings')
    .optional()
    .isObject()
    .withMessage('Configurações devem ser um objeto'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { establishmentId } = req.params;
    const { name, phone, address, settings } = req.body;
    const user = req.user;

    const establishment = await Establishment.findByEstablishmentId(establishmentId);

    if (!establishment || establishment.userId !== user.id) {
      return res.status(404).json({
        success: false,
        error: 'Estabelecimento não encontrado'
      });
    }

    // Atualizar campos se fornecidos
    const updateData = {};
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (address) updateData.address = address;
    if (settings) updateData.settings = { ...establishment.settings, ...settings };

    await establishment.update(updateData);

    res.json({
      success: true,
      message: 'Estabelecimento atualizado com sucesso',
      establishment: {
        id: establishment.id,
        name: establishment.name,
        phone: establishment.phone,
        address: establishment.address,
        settings: establishment.settings,
        updated_at: establishment.updated_at
      }
    });

  } catch (error) {
    console.error('Erro ao atualizar estabelecimento:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Ativar/desativar estabelecimento
router.patch('/:establishmentId/toggle', authenticateToken, async (req, res) => {
  try {
    const { establishmentId } = req.params;
    const user = req.user;

    const establishment = await Establishment.findByEstablishmentId(establishmentId);

    if (!establishment || establishment.userId !== user.id) {
      return res.status(404).json({
        success: false,
        error: 'Estabelecimento não encontrado'
      });
    }

    await establishment.toggle();

    res.json({
      success: true,
      message: `Estabelecimento ${establishment.isActive ? 'ativado' : 'desativado'} com sucesso`,
      isActive: establishment.isActive
    });

  } catch (error) {
    console.error('Erro ao alterar status do estabelecimento:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Configurar Arduino
router.patch('/:establishmentId/arduino', [
  authenticateToken,
  body('deviceId')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('ID do dispositivo deve ter entre 1 e 50 caracteres'),
  body('firmwareVersion')
    .optional()
    .trim()
    .isLength({ min: 1, max: 20 })
    .withMessage('Versão do firmware deve ter entre 1 e 20 caracteres'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { establishmentId } = req.params;
    const { deviceId, firmwareVersion } = req.body;
    const user = req.user;

    const establishment = await Establishment.findByEstablishmentId(establishmentId);

    if (!establishment || establishment.userId !== user.id) {
      return res.status(404).json({
        success: false,
        error: 'Estabelecimento não encontrado'
      });
    }

    // Atualizar configurações do Arduino
    const arduinoConfig = { ...establishment.arduinoConfiguration };
    if (deviceId) arduinoConfig.deviceId = deviceId;
    if (firmwareVersion) arduinoConfig.firmwareVersion = firmwareVersion;

    await establishment.configureArduino(arduinoConfig);

    res.json({
      success: true,
      message: 'Configurações do Arduino atualizadas',
      arduinoConfiguration: establishment.arduinoConfiguration
    });

  } catch (error) {
    console.error('Erro ao configurar Arduino:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

module.exports = router;
