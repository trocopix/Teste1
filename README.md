# 🏦 Sistema de Troco Automático - EFI Bank

Sistema completo para automatizar o envio de troco via PIX usando a API do EFI Bank. Ideal para estabelecimentos comerciais que desejam modernizar o processo de devolução de troco.

## 🚀 Funcionalidades

### ✨ Principais
- **Cadastro de empresas** com subcontas individuais
- **Cálculo automático de troco** com validação de limites
- **Envio automático via PIX** usando EFI Bank API
- **Sistema de subcontas** com saldos e limites por empresa
- **Controle de limites** (máximo R$ 99,99 por PIX)
- **Histórico completo** de todas as transações
- **Dashboard com estatísticas** em tempo real

### 🔒 Segurança
- Autenticação JWT
- Validação de dados
- Rate limiting
- Middleware de segurança (Helmet)
- CORS configurado

### 📱 Integração
- **Arduino**: API para cálculo de troco sem autenticação
- **EFI Bank**: Integração completa com API oficial
- **MongoDB**: Banco de dados robusto e escalável
- **Vercel**: Deploy automático

## 🏗️ Arquitetura

```
src/
├── config/          # Configurações (DB, etc.)
├── models/          # Modelos MongoDB
├── routes/          # Rotas da API
├── services/        # Serviços (EFI Bank, etc.)
└── server.js        # Servidor principal
```

## 🛠️ Tecnologias

- **Backend**: Node.js + Express
- **Banco**: MongoDB + Mongoose
- **Autenticação**: JWT + bcrypt
- **Validação**: express-validator
- **Segurança**: Helmet + CORS
- **Deploy**: Vercel

## 📋 Pré-requisitos

- Node.js 18+
- MongoDB
- Conta EFI Bank com API habilitada
- Certificado digital (.p12) do EFI Bank

## ⚙️ Instalação

### 1. Clone o repositório
```bash
git clone <seu-repositorio>
cd troco-automatico-api
```

### 2. Instale as dependências
```bash
npm install
```

### 3. Configure as variáveis de ambiente
Copie o arquivo `env.example` para `.env` e configure:

```bash
# Configurações do Servidor
PORT=3000
NODE_ENV=development

# MongoDB
MONGODB_URI=mongodb://localhost:27017/troco-automatico

# EFI Bank API
EFI_BANK_API_URL=https://api.efibank.com.br
EFI_BANK_CLIENT_ID=seu_client_id_aqui
EFI_BANK_CLIENT_SECRET=seu_client_secret_aqui
EFI_BANK_CERT_PATH=./certs/efi-cert.p12

# JWT
JWT_SECRET=sua_chave_jwt_super_secreta_aqui
JWT_EXPIRES_IN=24h

# Limites do Sistema
MAX_PIX_AMOUNT=99.99
MIN_PIX_AMOUNT=0.01
```

### 4. Configure o certificado EFI Bank
```bash
mkdir certs
# Coloque seu certificado .p12 na pasta certs/
```

### 5. Execute o projeto
```bash
# Desenvolvimento
npm run dev

# Produção
npm start
```

## 🚀 Deploy no Vercel

### 1. Conecte com GitHub
- Faça push do código para seu repositório
- Conecte o repositório no Vercel

### 2. Configure as variáveis de ambiente
No painel do Vercel, adicione todas as variáveis do `.env`

### 3. Deploy automático
O Vercel detectará automaticamente o `vercel.json` e fará o deploy

## 📚 API Endpoints

### 🔐 Autenticação
```
POST /api/auth/register    # Cadastro de empresa
POST /api/auth/login       # Login
GET  /api/auth/verify      # Verificar token
PUT  /api/auth/change-password # Alterar senha
```

### 👤 Contas
```
GET  /api/accounts/profile      # Perfil do usuário
PUT  /api/accounts/profile      # Atualizar perfil
GET  /api/accounts/stats        # Estatísticas da conta
GET  /api/accounts/transactions # Histórico de transações
PUT  /api/accounts/subaccount   # Configurar subconta
```

### 💰 PIX
```
POST /api/pix/process           # Processar PIX
GET  /api/pix/status/:id        # Status da transação
DELETE /api/pix/cancel/:id      # Cancelar PIX
POST /api/pix/retry/:id         # Reprocessar PIX
```

### 🏪 Troco
```
POST /api/troco/calculate       # Calcular troco
POST /api/troco/process         # Processar troco via PIX
GET  /api/troco/history         # Histórico de trocos
GET  /api/troco/stats           # Estatísticas de troco
POST /api/troco/simulate        # Simular cálculo (Arduino)
```

## 🔌 Integração com Arduino

### Cálculo de Troco (sem autenticação)
```bash
POST /api/troco/simulate
{
  "totalAmount": 25.50,
  "paidAmount": 30.00
}
```

**Resposta:**
```json
{
  "success": true,
  "message": "Troco calculado com sucesso",
  "change": 4.50,
  "formattedChange": "R$ 4,50",
  "canProcessPix": true,
  "limits": {
    "maxPixAmount": 99.99,
    "minPixAmount": 0.01
  }
}
```

### Fluxo Completo
1. **Arduino** → Calcula troco via `/api/troco/simulate`
2. **Sistema** → Valida limites e disponibilidade
3. **Cliente** → Fornece chave PIX
4. **API** → Processa PIX via EFI Bank
5. **Confirmação** → Troco enviado automaticamente

## 💳 Configuração EFI Bank

### 1. Obtenha credenciais
- Acesse o painel EFI Bank
- Gere `client_id` e `client_secret`
- Baixe o certificado digital (.p12)

### 2. Configure certificado
```bash
# Coloque o certificado na pasta certs/
EFI_BANK_CERT_PATH=./certs/efi-cert.p12
EFI_BANK_CERT_PASSWORD=sua_senha_aqui
```

### 3. Teste a conexão
```bash
# Health check da API
GET /api/health
```

## 📊 Modelos de Dados

### User (Usuário/Empresa)
```javascript
{
  name: "Nome da Empresa",
  email: "empresa@email.com",
  company: "Nome Fantasia",
  cnpj: "12.345.678/0001-90",
  phone: "(11) 99999-9999",
  role: "company"
}
```

### SubAccount (Subconta)
```javascript
{
  userId: "ObjectId",
  companyName: "Nome da Empresa",
  balance: 1000.00,
  maxPixAmount: 99.99,
  dailyPixLimit: 500.00,
  dailyPixUsed: 150.00
}
```

### PixTransaction (Transação PIX)
```javascript
{
  subAccountId: "ObjectId",
  userId: "ObjectId",
  pixKey: "chave@pix.com",
  pixKeyType: "email",
  amount: 25.50,
  status: "completed",
  efiTransactionId: "txid_efi"
}
```

## 🔒 Segurança e Limites

### Limites por Transação
- **Mínimo**: R$ 0,01
- **Máximo**: R$ 99,99

### Limites Diários
- **Padrão**: R$ 500,00 por empresa
- **Configurável** por subconta

### Validações
- Chave PIX válida
- Saldo suficiente
- Limites respeitados
- Rate limiting por IP

## 🧪 Testes

### 1. Teste de conectividade
```bash
curl http://localhost:3000/api/health
```

### 2. Teste de cadastro
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Empresa Teste",
    "email": "teste@empresa.com",
    "password": "123456",
    "company": "Empresa Teste LTDA",
    "cnpj": "12.345.678/0001-90",
    "phone": "(11) 99999-9999"
  }'
```

### 3. Teste de cálculo de troco
```bash
curl -X POST http://localhost:3000/api/troco/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "totalAmount": 25.50,
    "paidAmount": 30.00
  }'
```

## 🚨 Troubleshooting

### Erro de conexão MongoDB
```bash
# Verifique se o MongoDB está rodando
mongod --version
# Verifique a URI no .env
```

### Erro de certificado EFI Bank
```bash
# Verifique se o arquivo existe
ls -la certs/
# Verifique a senha no .env
```

### Erro de autenticação EFI Bank
```bash
# Verifique as credenciais
echo $EFI_BANK_CLIENT_ID
echo $EFI_BANK_CLIENT_SECRET
```

## 📈 Monitoramento

### Logs
- Todas as requisições são logadas
- Erros são capturados e logados
- Transações PIX são rastreadas

### Métricas
- Saldo das subcontas
- Volume de transações
- Taxa de sucesso
- Tempo de resposta

## 🔄 Atualizações

### Backup automático
- MongoDB com replicação
- Logs persistentes
- Versionamento de API

### Rollback
- Deploy reversível no Vercel
- Migrações de banco versionadas
- Configurações em variáveis de ambiente

## 📞 Suporte

Para dúvidas ou problemas:
1. Verifique os logs do servidor
2. Teste a conectividade com EFI Bank
3. Valide as configurações no `.env`
4. Consulte a documentação da API EFI Bank

## 📄 Licença

MIT License - veja o arquivo LICENSE para detalhes.

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch para sua feature
3. Commit suas mudanças
4. Push para a branch
5. Abra um Pull Request

---

**Desenvolvido com ❤️ para modernizar o sistema de troco brasileiro**
