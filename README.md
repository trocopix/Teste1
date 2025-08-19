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

### Certificados mTLS (formato PEM)
- `EFI_CERT` - Certificado cliente (.pem)
- `EFI_KEY` - Chave privada (.key)
- `EFI_CA_CERT` - Certificado CA (.pem)

### Segurança
- `VERCEL_API_SECRET` - Secret para proteger a API

## Como configurar os certificados

1. Converta seus certificados para formato PEM se necessário
2. Copie o conteúdo completo de cada arquivo (incluindo `-----BEGIN CERTIFICATE-----` e `-----END CERTIFICATE-----`)
3. Cole no campo correspondente no Vercel

## Endpoint

Após o deploy, a função estará disponível em:
```
https://seu-projeto.vercel.app/api/process-pix
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

## Troubleshooting

- Verifique se todos os certificados estão no formato PEM correto
- Confirme que todas as variáveis de ambiente estão configuradas
- Use `vercel logs` para debug de problemas