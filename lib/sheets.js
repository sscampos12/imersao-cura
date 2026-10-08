/**
 * Sincronização com o Google Sheets via Apps Script (web app).
 */

class GoogleSheetsSync {
  constructor() {
    this.webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL || '';
    this.spreadsheetId =
      process.env.SPREADSHEET_ID ||
      '1eNTv86_RS5wgyCWxJCGgOH9CJNTcdZYHS-b1ah6QU4s';

    // Cache curto (30s) pra não sobrecarregar o Apps Script
    this._dispCache = null;
    this._dispCacheAt = 0;
    this._dispCacheMs = 30 * 1000;
  }

  async enviar(payload, tentativas = 4) {
    let ultimoErro;

    for (let i = 1; i <= tentativas; i++) {
      try {
        const res = await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
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
        await new Promise((r) => setTimeout(r, 2000 * i));
      }
    }

    console.warn('[Sheets Sync] Falha após tentativas:', ultimoErro?.message);
    return { ok: false, error: ultimoErro?.message };
  }

  async sincronizarInscricao(item) {
    if (!this.webhookUrl) {
      return { ok: false, reason: 'GOOGLE_SHEETS_WEBHOOK_URL não configurado' };
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

    const result = await this.enviar(payload);
    // Invalida cache de disponibilidade
    this._dispCache = null;
    this._dispCacheAt = 0;
    return result;
  }

  async atualizarStatus(chargeId, novoStatus = 'Confirmado (pago)', customId = '') {
    if (!this.webhookUrl) return { ok: false };

    const result = await this.enviar({
      action: 'updateStatus',
      spreadsheetId: this.spreadsheetId,
      chargeId: String(chargeId || ''),
      customId: String(customId || ''),
      status: novoStatus,
    });

    this._dispCache = null;
    this._dispCacheAt = 0;
    return result;
  }

  /** Busca disponibilidade direto da planilha (com cache 30s) */
  async buscarDisponibilidade() {
    if (
      this._dispCache &&
      Date.now() - this._dispCacheAt < this._dispCacheMs
    ) {
      return this._dispCache;
    }

    if (!this.webhookUrl) {
      // Fallback: valores máximos (não bloqueia venda se Apps Script falhar)
      return {
        adultosRestantes: 120,
        almocosRestantes: 50,
        criancasRestantes: 20,
        bebesRestantes: 6,
        totaisConfirmados: { adultos: 0, almocos: 0, criancas: 0, bebes: 0 },
        limitesTotais: { adultos: 120, almocos: 50, criancas: 20, bebes: 6 },
      };
    }

    try {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getDisponibilidade',
          spreadsheetId: this.spreadsheetId,
        }),
        signal: AbortSignal.timeout(15000),
      });

      const corpo = await res.json();

      if (!res.ok || corpo.ok === false) {
        throw new Error(corpo.error || `HTTP ${res.status}`);
      }

      this._dispCache = corpo;
      this._dispCacheAt = Date.now();

      return corpo;
    } catch (erro) {
      console.warn('[Sheets Sync] Erro ao buscar disponibilidade:', erro.message);

      return (
        this._dispCache || {
          adultosRestantes: 120,
          almocosRestantes: 50,
          criancasRestantes: 20,
          bebesRestantes: 6,
          totaisConfirmados: { adultos: 0, almocos: 0, criancas: 0, bebes: 0 },
          limitesTotais: { adultos: 120, almocos: 50, criancas: 20, bebes: 6 },
        }
      );
    }
  }
}

module.exports = new GoogleSheetsSync();