/**
 * Módulo de Sincronização com o Google Sheets
 * Suporta webhook simples via Google Apps Script (sem necessidade de chaves complexas do GCP)
 */

class GoogleSheetsSync {
  constructor() {
    this.webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL || '';
    this.spreadsheetId = process.env.SPREADSHEET_ID || '1eNTv86_RS5wgyCWxJCGgOH9CJNTcdZYHS-b1ah6QU4s';
  }

  /**
   * Envia uma nova linha de inscrição para a planilha
   */
  async sincronizarInscricao(item) {
    if (!this.webhookUrl) {
      // Se não configurado webhook externo, os dados ficam salvos com segurança em data/inscricoes.json e data/inscricoes.csv
      return { ok: false, reason: 'GOOGLE_SHEETS_WEBHOOK_URL não configurado (salvo localmente)' };
    }

    try {
      const payload = {
        action: 'appendRow',
        spreadsheetId: this.spreadsheetId,
        row: [
          item.dataHora,
          item.responsavel,
          (item.adultosNomes || []).join(' | '),
          item.whatsapp,
          item.email,
          item.qtdAdultos,
          item.qtdCriancas,
          (item.criancas || []).map((c) => `${c.nome || 'Criança'} (${c.idade}a)`).join(', '),
          item.qtdAlmocos,
          item.almocosDetalhes || '',
          `R$ ${(item.valorTotal || 0).toFixed(2).replace('.', ',')}`,
          item.formaPagamento || 'Link Efí',
          item.status,
          String(item.chargeId || ''),
        ],
      };

      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.warn(`[Sheets Sync] Falha ao enviar para o Google Sheets [${res.status}]`);
        return { ok: false, status: res.status };
      }

      return { ok: true };
    } catch (err) {
      console.warn('[Sheets Sync Error]:', err.message);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Atualiza o status da inscrição para 'Confirmado (pago)' na planilha
   */
  async atualizarStatus(chargeId, novoStatus = 'Confirmado (pago)') {
    if (!this.webhookUrl) return { ok: false };

    try {
      const payload = {
        action: 'updateStatus',
        spreadsheetId: this.spreadsheetId,
        chargeId: String(chargeId),
        status: novoStatus,
      };

      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      return { ok: res.ok };
    } catch (err) {
      console.warn('[Sheets Sync Update Error]:', err.message);
      return { ok: false, error: err.message };
    }
  }
}

module.exports = new GoogleSheetsSync();
