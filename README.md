# Imersão de Cura — Sistema Completo de Inscrição & Pagamento

Sistema completo, independente e profissional de inscrição com **Carrinho de Compras**, suporte a **Efí Bank** e **Mercado Pago** (PIX e Cartão de Crédito) e sincronização automática com o **Google Sheets**.

---

## 🚀 Principais Funcionalidades

1. **Lógica de Carrinho Independente:**
   - **Ingressos de Adultos (R$ 35,00 cada):** Campo obrigatório para o responsável e campos dinâmicos para o nome completo de cada participante extra. Limite rígido de **120 vagas**.
   - **Almoço no Evento (R$ 25,00 cada):** Item 100% avulso e opcional. O participante pode comprar a quantidade que quiser (0, 1, 2, 3...), sem estar amarrado à quantidade de adultos. Limite rígido de **50 almoços** (com aviso automático de "Esgotado").
   - **Espaço Kids (R$ 0,00 - Gratuito):** Entrada grátis para crianças de 0 a 11 anos, com campos para Nome e Idade. Controle separado de **20 crianças** (3 a 11 anos) e **6 bebês** (até 2 anos).
   - **Resumo do Pedido em Tempo Real:** Mostra os itens adicionados, subtotais e o total geral com cálculo instantâneo.

2. **Plataformas de Pagamento Suportadas:**
   - **Efí Bank (Padrão):** API de Cobranças via Basic Auth (`/v1/charge/one-step/link`), sem mTLS. Aceita PIX e Cartão.
   - **Mercado Pago (Opcional):** Checkout Pro (`/checkout/preferences`). Aceita PIX, Cartão e Saldo em Conta.
   - Webhooks integrados para atualizar automaticamente a planilha para `"Confirmado (pago)"`.

3. **Sincronização com o Google Sheets:**
   - Grava cada inscrição com data, nomes de todos os participantes, WhatsApp, e-mail, quantidades, valores e ID da cobrança.
   - Script pronto do Google Apps Script incluso (`google-apps-script.js`) para sincronização com zero burocracia.
   - Armazenamento local de segurança em `data/inscricoes.json` e `data/inscricoes.csv` (nunca perde nenhuma inscrição).

---

## ⚙️ Configuração das Chaves de Pagamento (`.env`)

Você pode usar apenas a **Efí**, apenas o **Mercado Pago**, ou deixar **ambos ativos** para o cliente escolher:

```env
# Se for usar a Efí Bank:
EFI_CLIENT_ID=Client_Id_seu_codigo_aqui
EFI_CLIENT_SECRET=Client_Secret_seu_codigo_aqui
EFI_SANDBOX=false

# Se for usar o Mercado Pago:
MERCADO_PAGO_ACCESS_TOKEN=APP_USR-seu_token_aqui

# Planilha do Google Sheets:
SPREADSHEET_ID=1eNTv86_RS5wgyCWxJCGgOH9CJNTcdZYHS-b1ah6QU4s
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/SUA_URL/exec
```

---

## 🖥️ Como Executar no Computador

```bash
node server.js
```
Acesse no navegador: `http://localhost:3000`
