/**
 * Cliente de Integração com a API Pix da Efí Bank
 */
class EfiClient {
  constructor(config = {}) {
    this.clientId = config.clientId || process.env.EFI_CLIENT_ID || '';
    this.clientSecret = config.clientSecret || process.env.EFI_CLIENT_SECRET || '';
    this.sandbox = config.sandbox !== undefined 
      ? String(config.sandbox) === 'true' 
      : String(process.env.EFI_SANDBOX) === 'true';
    this.certificado = config.certificado || process.env.EFI_CERTIFICADO || '';
    this.chavePix = config.chavePix || process.env.EFI_CHAVE_PIX || '';
  }

  getBaseUrl() {
    return this.sandbox
      ? 'https://api-h.efipay.com.br'
      : 'https://api.efipay.com.br';
  }

  async getAccessToken() {
    const clientId = (this.clientId || '').trim();
    const clientSecret = (this.clientSecret || '').trim();

    if (!clientId || !clientSecret) {
      throw new Error('Credenciais da Efí não configuradas.');
    }

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const url = `${this.getBaseUrl()}/v1/authorize`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ grant_type: 'client_credentials' }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Falha na autenticação Efí [${res.status}]: ${errText}`);
    }

    const data = await res.json();
    return data.access_token;
  }

  /**
   * Cria uma cobrança Pix imediata (gera Pix Copia e Cola e QR Code)
   * @param {number} valorEmReais - Valor total (ex: 40.00)
   * @param {Object} devedor - Nome e CPF/CNPJ (opcional)
   * @param {string} customId - Identificador único
   */
  async createPixCharge(valorEmReais, devedor = {}, customId = '') {
    const token = await this.getAccessToken();
    const url = `${this.getBaseUrl()}/v2/cob`;

    const valorFormatado = Number(valorEmReais).toFixed(2);
    const chavePix = this.chavePix || process.env.EFI_CHAVE_PIX;

    if (!chavePix) {
      throw new Error('Chave Pix (EFI_CHAVE_PIX) não configurada no arquivo .env.');
    }

    const payload = {
      calendario: {
        expiracao: 3600, // 1 hora de validade
      },
      valor: {
        original: valorFormatado,
      },
      chave: chavePix,
      solicitacaoPagador: `Inscrição Imersão de Cura - ${customId}`,
    };

    if (devedor.nome) {
      payload.devedor = {
        nome: devedor.nome,
        ...(devedor.cpf ? { cpf: devedor.cpf.replace(/\D/g, '') } : {}),
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erro ao gerar Pix na Efí [${res.status}]: ${errText}`);
    }

    const data = await res.json();
    const txid = data.txid;
    const locId = data.loc?.id;

    if (!locId) {
      throw new Error('A Efí não retornou o local do QR Code Pix.');
    }

    // Busca o QR Code e o Copia e Cola usando o locId
    const qrData = await this.getPixQrCode(locId);

    return {
      chargeId: txid,
      pixCopiaECola: qrData.pixCopiaECola,
      qrCodeImage: qrData.imagemQrcode,
      paymentUrl: qrData.pixCopiaECola, // Usado como fallback
    };
  }

  async getPixQrCode(locId) {
    const token = await this.getAccessToken();
    const url = `${this.getBaseUrl()}/v2/loc/${locId}/qrcode`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erro ao buscar QR Code Pix [${res.status}]: ${errText}`);
    }

    const data = await res.json();
    return {
      pixCopiaECola: data.qrcode,
      imagemQrcode: data.imagemQrcode,
    };
  }

  async getNotificationDetails(notificationToken) {
    // Mantido para compatibilidade com webhooks de baixa
    return { paidChargeIds: [] };
  }
}

module.exports = EfiClient;