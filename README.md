# EFI Bank PIX - Vercel Deployment

Este projeto contém a função serverless para processar transações PIX com o EFI Bank usando mTLS.

## Estrutura do Projeto

```
deploy/
├── api/
│   └── process-pix.js     # Função serverless principal
├── vercel.json            # Configuração do Vercel
├── package.json           # Dependências e scripts
└── README.md             # Este arquivo
```

## Deploy no Vercel

### 1. Instalar Vercel CLI
```bash
npm i -g vercel
```

### 2. Fazer login no Vercel
```bash
vercel login
```

### 3. Deploy
```bash
cd deploy
vercel --prod
```

## Variáveis de Ambiente Necessárias

Configure essas variáveis no painel do Vercel:

### Credenciais EFI Bank
- `EFI_BANK_CLIENT_ID` - Client ID do EFI Bank
- `EFI_BANK_CLIENT_SECRET` - Client Secret do EFI Bank

### Certificados mTLS (formato PEM ou Base64)
- `EFI_CERT` - Certificado cliente (.pem)
- `EFI_KEY` - Chave privada (.key)
- `EFI_CA_CERT` - Certificado CA (.pem)

### Segurança
- `VERCEL_API_SECRET` - Secret para proteger a API

## Como configurar os certificados

### Opção 1: Base64 (Recomendado para Vercel)

1. **Gere as versões base64 dos seus certificados:**
```bash
# Para o certificado cliente
base64 -i client-cert.pem -o cert.b64

# Para a chave privada  
base64 -i client-key.pem -o key.b64

# Para o certificado CA
base64 -i ca-cert.pem -o ca.b64
```

2. **Configure via Vercel CLI:**
```bash
# Configure cada certificado
vercel env add EFI_CERT production < cert.b64
vercel env add EFI_KEY production < key.b64  
vercel env add EFI_CA_CERT production < ca.b64

# Configure as outras variáveis
vercel env add EFI_BANK_CLIENT_ID production
vercel env add EFI_BANK_CLIENT_SECRET production
vercel env add VERCEL_API_SECRET production
```

### Opção 2: PEM Direto (Formato de linha única)

1. Converta o PEM para uma linha única removendo quebras de linha:
```bash
# Para certificado cliente
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' client-cert.pem

# Para chave privada
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' client-key.pem

# Para certificado CA
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' ca-cert.pem
```

2. Cole o resultado no campo correspondente no painel do Vercel

## Endpoints

Após o deploy, as funções estarão disponíveis:

### Processar PIX
```
https://seu-projeto.vercel.app/api/process-pix
```

### Health Check (validar certificados)
```
https://seu-projeto.vercel.app/api/health
```

## Uso

```javascript
const response = await fetch('https://seu-projeto.vercel.app/api/process-pix', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Secret': 'seu-vercel-api-secret'
  },
  body: JSON.stringify({
    establishment_id: "123",
    changeAmount: 10.50,
    pixKey: "sua-chave-pix"
  })
});
```

## Logs

Para ver os logs da função:
```bash
vercel logs
```

## Testando a Configuração

### 1. Verificar Health Check
```bash
curl https://seu-projeto.vercel.app/api/health
```

Resposta esperada com `"status": "ok"` e todos os checks como `"valid"` ou `"created"`.

### 2. Testar PIX
```bash
curl -X POST https://seu-projeto.vercel.app/api/process-pix \
  -H "Content-Type: application/json" \
  -H "X-API-Secret: seu-vercel-api-secret" \
  -d '{
    "establishment_id": "123",
    "changeAmount": 10.50,
    "pixKey": "sua-chave-pix@exemplo.com"
  }'
```

## Troubleshooting

### Erro "PEM routines::no start line"
- Use a Opção 1 (Base64) ao invés de PEM direto
- Verifique o health check: `/api/health`
- Confirme que os certificados não têm caracteres extras

### Outros problemas
- Verifique se todas as variáveis de ambiente estão configuradas
- Use `vercel logs` para debug detalhado
- Teste primeiro o endpoint `/api/health` antes do `/api/process-pix`