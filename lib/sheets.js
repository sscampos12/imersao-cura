/**
 * Sincronização com o Google Sheets via Google Apps Script (web app).
 * Colunas: A..M como antes; N = customId, O = paymentId,
 * P = adultos adicionais, Q = observação.
 */

class GoogleSheetsSync {
  constructor() {
    this.webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL || '';
    this.spreadsheetId =
      process.env.SPREADSHEET_ID ||
      '1eNTv86_RS5wgyCWxJCGgOH9CJNTcdZYHS-b1ah6QU4s';
  }

  async enviar(payload, tentativas = 4) {
    let ultimoErro;

    for (let i = 1; i <= tentativas; i++) {
      try {
        const res = await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          // Apps Script pode demorar com o upsert; 30s de espera.
          signal: AbortSignal.timeout(30000),
        });

        const corpo = await res.json().catch(() => ({}));

        if (res.ok && corpo.ok !== false) {
          return { ok: true, ...corpo };
        }

        ultimoErro = new Error(corpo.error || `HTTP ${res.status}`);
      } catch (erro) {
        ultimoErro = erro;
      }

      if (i < tentativas) {
        // 2s, 6s, 12s entre as tentativas
        await new Promise((resolve) => setTimeout(resolve, 2000 * i));
      }
    }

    console.warn('[Sheets Sync] Falha após tentativas:', ultimoErro?.message);
    return { ok: false, error: ultimoErro?.message };
  }

  /** Cria a linha da inscrição ou atualiza se o customId já existir. */
  async sincronizarInscricao(item) {
    if (!this.webhookUrl) {
      return {
        ok: false,
        reason: 'GOOGLE_SHEETS_WEBHOOK_URL não configurado (salvo localmente)',
      };
    }

    const criancas = Array.isArray(item.criancas) ? item.criancas : [];
    const adultosExtras = Array.isArray(item.adultosNomes)
      ? item.adultosNomes.join(', ')
      : '';

    const payload = {
      action: 'upsertRow',
      spreadsheetId: this.spreadsheetId,
      customId: String(item.customId || ''),
      row: [
        item.dataHora,
        item.responsavel,
        item.whatsapp,
        item.email,
        item.qtdAdultos,
        criancas.length,
        criancas.map((c) => `${c.nome || 'Criança'} (${c.idade}a)`).join(', '),
        item.qtdAlmocos,
        item.qtdDoces || 0,
        `R$ ${Number(item.valorTotal || 0).toFixed(2).replace('.', ',')}`,
        item.formaPagamento || 'Mercado Pago',
        item.status,
        String(item.chargeId || ''),
        String(item.customId || ''),
        String(item.paymentId || ''),
        adultosExtras,
        item.observacao || '',
      ],
    };

    return this.enviar(payload);
  }

  /** Atualiza o status pela coluna chargeId (M) ou customId (N). */
  async atualizarStatus(chargeId, novoStatus = 'Confirmado (pago)', customId = '') {
    if (!this.webhookUrl) return { ok: false };

    return this.enviar({
      action: 'updateStatus',
      spreadsheetId: this.spreadsheetId,
      chargeId: String(chargeId || ''),
      customId: String(customId || ''),
      status: novoStatus,
    });
  }
}

module.exports = new GoogleSheetsSync();