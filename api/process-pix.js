const https = require('https');

// Helper functions for PEM handling (supports both base64 and direct PEM)
function normalizePem(value, type) {
  if (!value) return undefined;
  
  // Check if it's base64 encoded (try to decode first)
  let pemContent = value;
  try {
    if (!value.includes('-----BEGIN')) {
      pemContent = Buffer.from(value, 'base64').toString('utf8');
    }
  } catch (e) {
    // Not base64, continue with original value
  }
  
  const v = String(pemContent).trim();
  const begin = `-----BEGIN ${type}-----`;
  const end = `-----END ${type}-----`;
  
  // Already properly formatted
  if (v.includes('\n') && v.includes(begin)) return v;
  
  // Single-line format - normalize to multi-line
  let body = v.replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '');
  body = body.replace(/[\r\n\s]/g, '');
  const chunks = body.match(/.{1,64}/g) || [];
  return `${begin}\n${chunks.join('\n')}\n${end}\n`;
}

function normalizeCA(value) {
  if (!value) return undefined;
  
  // Check if it's base64 encoded
  let pemContent = value;
  try {
    if (!value.includes('-----BEGIN')) {
      pemContent = Buffer.from(value, 'base64').toString('utf8');
    }
  } catch (e) {
    // Not base64, continue with original value
  }
  
  const v = String(pemContent).trim();
  if (v.includes('-----BEGIN CERTIFICATE-----')) {
    const blocks = v.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    return blocks && blocks.length ? blocks : v;
  }
  
  // Single-line format
  return [normalizePem(v, 'CERTIFICATE')];
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

    // Create mTLS agent with certificates (with proper PEM normalization)
    const agent = new https.Agent({
      cert: normalizePem(process.env.EFI_CERT, 'CERTIFICATE'),
      key: normalizePem(process.env.EFI_KEY, 'PRIVATE KEY'),
      ca: normalizeCA(process.env.EFI_CA_CERT),
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
        'Content-Length': Buffer.byteLength(postData)
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

    // Create mTLS agent with certificates (reuse helper functions)
    const agent = new https.Agent({
      cert: normalizePem(process.env.EFI_CERT, 'CERTIFICATE'),
      key: normalizePem(process.env.EFI_KEY, 'PRIVATE KEY'),
      ca: normalizeCA(process.env.EFI_CA_CERT),
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
        'Content-Length': Buffer.byteLength(postData)
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