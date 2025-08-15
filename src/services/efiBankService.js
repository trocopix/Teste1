const axios = require('axios');
const fs = require('fs');
const path = require('path');

class EfiBankService {
  constructor() {
    this.baseURL = process.env.EFI_BANK_API_URL;
    this.clientId = process.env.EFI_BANK_CLIENT_ID;
    this.clientSecret = process.env.EFI_BANK_CLIENT_SECRET;
    this.certPath = process.env.EFI_BANK_CERT_PATH;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  // Autenticação com EFI Bank
  async authenticate() {
    try {
      if (this.accessToken && this.tokenExpiry > Date.now()) {
        return this.accessToken;
      }

      const authData = {
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret
      };

      const response = await axios.post(`${this.baseURL}/oauth/token`, authData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        httpsAgent: this.getHttpsAgent()
      });

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);

      console.log('✅ Autenticado com EFI Bank');
      return this.accessToken;
    } catch (error) {
      console.error('❌ Erro na autenticação EFI Bank:', error.response?.data || error.message);
      throw new Error('Falha na autenticação com EFI Bank');
    }
  }

  // Configurar agente HTTPS com certificado
  getHttpsAgent() {
    if (!this.certPath || !fs.existsSync(this.certPath)) {
      console.warn('⚠️ Certificado EFI Bank não encontrado, usando configuração padrão');
      return null;
    }

    const https = require('https');
    return new https.Agent({
      pfx: fs.readFileSync(this.certPath),
      passphrase: process.env.EFI_BANK_CERT_PASSWORD || ''
    });
  }

  // Fazer PIX
  async makePix(pixData) {
    try {
      const token = await this.authenticate();
      
      const pixPayload = {
        calendario: {
          expiracao: 3600 // 1 hora
        },
        devedor: {
          nome: pixData.debtorName || 'Cliente',
          cpf: pixData.debtorCpf || '00000000000',
          cnpj: pixData.debtorCnpj || null
        },
        valor: {
          original: pixData.amount.toFixed(2)
        },
        chave: pixData.pixKey,
        solicitacaoPagador: `Troco automático - ${pixData.description || 'Sistema de troco'}`
      };

      const response = await axios.post(`${this.baseURL}/v2/gn`, pixPayload, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        httpsAgent: this.getHttpsAgent()
      });

      console.log('✅ PIX criado com sucesso:', response.data.txid);
      
      return {
        success: true,
        transactionId: response.data.txid,
        qrCode: response.data.qrcode,
        qrCodeImage: response.data.imagemQrcode,
        response: response.data
      };

    } catch (error) {
      console.error('❌ Erro ao criar PIX:', error.response?.data || error.message);
      
      return {
        success: false,
        error: error.response?.data?.mensagem || error.message,
        statusCode: error.response?.status
      };
    }
  }

  // Consultar status do PIX
  async checkPixStatus(transactionId) {
    try {
      const token = await this.authenticate();
      
      const response = await axios.get(`${this.baseURL}/v2/gn/${transactionId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        httpsAgent: this.getHttpsAgent()
      });

      return {
        success: true,
        status: response.data.status,
        response: response.data
      };

    } catch (error) {
      console.error('❌ Erro ao consultar status PIX:', error.response?.data || error.message);
      
      return {
        success: false,
        error: error.response?.data?.mensagem || error.message,
        statusCode: error.response?.status
      };
    }
  }

  // Cancelar PIX
  async cancelPix(transactionId, reason = 'Cancelamento solicitado') {
    try {
      const token = await this.authenticate();
      
      const cancelPayload = {
        motivo: reason
      };

      const response = await axios.delete(`${this.baseURL}/v2/gn/${transactionId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        data: cancelPayload,
        httpsAgent: this.getHttpsAgent()
      });

      console.log('✅ PIX cancelado com sucesso:', transactionId);
      
      return {
        success: true,
        response: response.data
      };

    } catch (error) {
      console.error('❌ Erro ao cancelar PIX:', error.response?.data || error.message);
      
      return {
        success: false,
        error: error.response?.data?.mensagem || error.message,
        statusCode: error.response?.status
      };
    }
  }

  // Consultar saldo da conta
  async getBalance() {
    try {
      const token = await this.authenticate();
      
      const response = await axios.get(`${this.baseURL}/v1/gn/saldo`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        httpsAgent: this.getHttpsAgent()
      });

      return {
        success: true,
        balance: response.data.saldo,
        response: response.data
      };

    } catch (error) {
      console.error('❌ Erro ao consultar saldo:', error.response?.data || error.message);
      
      return {
        success: false,
        error: error.response?.data?.mensagem || error.message,
        statusCode: error.response?.status
      };
    }
  }

  // Validar chave PIX
  validatePixKey(pixKey, pixKeyType) {
    const validators = {
      cpf: /^\d{3}\.\d{3}\.\d{3}-\d{2}$/,
      cnpj: /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      phone: /^\+55\d{2}\d{5}\d{4}$/,
      random: /^[a-zA-Z0-9]{32}$/
    };

    if (!validators[pixKeyType]) {
      return { valid: false, error: 'Tipo de chave PIX inválido' };
    }

    if (!validators[pixKeyType].test(pixKey)) {
      return { valid: false, error: `Formato da chave PIX (${pixKeyType}) inválido` };
    }

    return { valid: true };
  }

  // Detectar tipo de chave PIX automaticamente
  detectPixKeyType(pixKey) {
    if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(pixKey)) return 'cpf';
    if (/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(pixKey)) return 'cnpj';
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pixKey)) return 'email';
    if (/^\+55\d{2}\d{5}\d{4}$/.test(pixKey)) return 'phone';
    if (/^[a-zA-Z0-9]{32}$/.test(pixKey)) return 'random';
    
    return null;
  }
}

module.exports = new EfiBankService();
