const https = require('https');

// Import helper functions from process-pix
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

// Health check endpoint for validating PEM certificates
module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const checks = {
      environment_variables: {},
      pem_validation: {},
      https_agent: 'pending'
    };

    // Check environment variables existence
    const requiredEnvs = [
      'EFI_BANK_CLIENT_ID',
      'EFI_BANK_CLIENT_SECRET', 
      'EFI_CERT',
      'EFI_KEY',
      'EFI_CA_CERT',
      'VERCEL_API_SECRET'
    ];

    for (const env of requiredEnvs) {
      checks.environment_variables[env] = process.env[env] ? 'present' : 'missing';
    }

    // Validate PEM certificate loading (without logging content)
    try {
      const cert = normalizePem(process.env.EFI_CERT, 'CERTIFICATE');
      checks.pem_validation.cert = cert && cert.includes('-----BEGIN CERTIFICATE-----') ? 'valid' : 'invalid';
    } catch (e) {
      checks.pem_validation.cert = `error: ${e.message}`;
    }

    try {
      const key = normalizePem(process.env.EFI_KEY, 'PRIVATE KEY');
      checks.pem_validation.key = key && key.includes('-----BEGIN PRIVATE KEY-----') ? 'valid' : 'invalid';
    } catch (e) {
      checks.pem_validation.key = `error: ${e.message}`;
    }

    try {
      const ca = normalizeCA(process.env.EFI_CA_CERT);
      checks.pem_validation.ca = ca && Array.isArray(ca) && ca.length > 0 ? 'valid' : 'invalid';
    } catch (e) {
      checks.pem_validation.ca = `error: ${e.message}`;
    }

    // Test HTTPS agent creation
    try {
      const agent = new https.Agent({
        cert: normalizePem(process.env.EFI_CERT, 'CERTIFICATE'),
        key: normalizePem(process.env.EFI_KEY, 'PRIVATE KEY'),
        ca: normalizeCA(process.env.EFI_CA_CERT),
        rejectUnauthorized: true
      });
      checks.https_agent = agent ? 'created' : 'failed';
    } catch (e) {
      checks.https_agent = `error: ${e.message}`;
    }

    // Overall status
    const hasErrors = Object.values(checks.environment_variables).includes('missing') ||
                     Object.values(checks.pem_validation).some(v => v.includes('error') || v === 'invalid') ||
                     checks.https_agent.includes('error');

    return res.status(200).json({
      status: hasErrors ? 'error' : 'ok',
      timestamp: new Date().toISOString(),
      checks,
      message: hasErrors ? 'Some checks failed - see details above' : 'All checks passed'
    });

  } catch (error) {
    console.error('Health check error:', error);
    return res.status(500).json({
      status: 'error',
      message: `Health check failed: ${error.message}`,
      timestamp: new Date().toISOString()
    });
  }
}