const https = require('https');

// Função de debug para checar PEMs
function peek(name, val) {
  if (!val) {
    console.error(`[ERRO] Variável ${name} está vazia ou não foi definida`);
    return;
  }
  const preview = val.slice(0, 60).replace(/\n/g, '\\n');
  console.log(`[DEBUG] ${name} começa com: ${preview}`);
  if (!val.includes('-----BEGIN')) {
    console.error(`[ERRO] ${name} não contém "-----BEGIN" → PEM inválido`);
  }
}

// Vercel serverless function with mTLS support for EFI Bank
module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate secret header
  const apiSecret = req.headers['x-api-secret'];
  if (apiSecret !== process.env.VERCEL_API_SECRET) {
    console.log('Unauthorized access attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Debug: checar variáveis de certificado antes de qualquer requisição
    peek('EFI_CERT', process.env.EFI_CERT);
    peek('EFI_KEY', process.env.EFI_KEY);
    peek('EFI_CA_CERT', process.env.EFI_CA_CERT);

    const { establishment_id, changeAmount, pixKey } = req.body;

    if (!establishment_id || !changeAmount || !pixKey) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: establishment_id, changeAmount, pixKey' 
      });
    }

    console.log('Processing PIX request:', { establishment_id, changeAmount, pixKey });

    // Step 1: Get OAuth token from EFI Bank
    const token = await getEFIToken();
    console.log('Token obtained successfully');

    // Step 2: Create PIX transaction
    const pixResult = await createPixTransaction(token, {
      establishment_id,
      changeAmount,
      pixKey
    });

    console.log('PIX transaction created:', pixResult);

    return res.status(200).json({
      success: true,
      data: pixResult
    });

  } catch (error) {
    console.error('Error processing PIX:', error);
    return res.status(500).json({
      success: false,
      message: `Erro no processamento: ${error.message}`
    });
  }
}

async function getEFIToken() {
  return new Promise((resolve, reject) => {
    const clientId = process.env.EFI_BANK_CLIENT_ID;
    const clientSecret = process.env.EFI_BANK_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      reject(new Error('EFI Bank credentials not configured'));
      return;
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    const postData = JSON.stringify({
      grant_type: 'client_credentials'
    });

    // Create mTLS agent with certificates
    const agent = new https.Agent({
      cert: process.env.EFI_CERT,
      key: process.env.EFI_KEY,
      ca: process.env.EFI_CA_CERT,
      rejectUnauthorized: true
    });

    const options = {
      hostname: 'openfinance-h.api.efipay.com.br',
      port: 443,
      path: '/oauth/token',
      method: 'POST',
      agent: agent,
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
        'Content-Length': postData.length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (res.statusCode === 200 && response.access_token) {
            resolve(response.access_token);
          } else {
            console.error('Token error response:', response);
            reject(new Error(`Token request failed: ${JSON.stringify(response)}`));
          }
        } catch (error) {
          console.error('Token parse error:', error);
          reject(new Error(`Failed to parse token response: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('Token request error:', error);
      reject(new Error(`Token request failed: ${error.message}`));
    });

    req.write(postData);
    req.end();
  });
}

async function createPixTransaction(token, { establishment_id, changeAmount, pixKey }) {
  return new Promise((resolve, reject) => {
    const transactionData = {
      calendario: {
        expiracao: 300 // 5 minutes
      },
      devedor: {
        cpf: "12345678901", // This should come from your system
        nome: "Cliente do Estabelecimento"
      },
      valor: {
        original: changeAmount.toFixed(2)
      },
      chave: pixKey,
      solicitacaoPagador: `Troco - Estabelecimento ${establishment_id}`
    };

    const postData = JSON.stringify(transactionData);

    const agent = new https.Agent({
      cert: process.env.EFI_CERT,
      key: process.env.EFI_KEY,
      ca: process.env.EFI_CA_CERT,
      rejectUnauthorized: true
    });

    const options = {
      hostname: 'openfinance-h.api.efipay.com.br',
      port: 443,
      path: '/v1/pix/cob',
      method: 'POST',
      agent: agent,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': postData.length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (res.statusCode === 201 || res.statusCode === 200) {
            resolve(response);
          } else {
            console.error('PIX creation error:', response);
            reject(new Error(`PIX creation failed: ${JSON.stringify(response)}`));
          }
        } catch (error) {
          console.error('PIX parse error:', error);
          reject(new Error(`Failed to parse PIX response: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('PIX request error:', error);
      reject(new Error(`PIX request failed: ${error.message}`));
    });

    req.write(postData);
    req.end();
  });
}
