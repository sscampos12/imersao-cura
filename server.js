const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

// Carrega as variáveis antes de importar as integrações.
const envPath = path.join(__dirname, '.env');

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');

  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const storage = require('./lib/storage');
const sheetsSync = require('./lib/sheets');

const PORT = Number(process.env.PORT || 3000);
const PRECO_ADULTO = 40;
const PRECO_ALMOCO = 25;
const PRECO_DOCE = 1.00;
const PUBLIC_DIR = path.resolve(__dirname, 'public');

// Contexto temporário do checkout por navegador.
const checkoutSessions = new Map();
const SESSION_DURATION = 60 * 60 * 1000;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

class MercadoPagoClient {
  constructor() {
    this.accessToken = (
      process.env.MERCADO_PAGO_ACCESS_TOKEN || ''
    ).trim();

    this.notificationUrl =
      process.env.MERCADO_PAGO_NOTIFICATION_URL || '';
  }

  async request(endpoint, options = {}) {
    if (!this.accessToken) {
      throw new Error(
        'MERCADO_PAGO_ACCESS_TOKEN não configurado.'
      );
    }

    const response = await fetch(
      `https://api.mercadopago.com${endpoint}`,
      {
        ...options,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error(
        '[Mercado Pago]',
        response.status,
        data.message || data.error
      );

      throw new HttpError(
        502,
        'O Mercado Pago não conseguiu concluir a solicitação.'
      );
    }

    return data;
  }

  async createPreference(items, payer, metadata) {
    const payload = {
      items: items.map((item) => ({
        title: item.title,
        quantity: item.quantity,
        unit_price: Number(item.unit_price.toFixed(2)),
        currency_id: 'BRL',
      })),

      payer: {
        name: payer.name || 'Participante',
        email: payer.email || 'participante@inscricao.com',
      },

      external_reference: metadata.externalReference,
      statement_descriptor: 'IMERSAO DE CURA',
    };

    if (payer.phone) {
      payload.payer.phone = {
        number: payer.phone,
      };
    }

    const notificationUrl =
      metadata.notificationUrl || this.notificationUrl;

    if (notificationUrl?.startsWith('https://')) {
      payload.notification_url = notificationUrl;
    }

    if (metadata.backUrl?.startsWith('https://')) {
      payload.back_urls = {
        success: metadata.backUrl,
        failure: metadata.backUrl,
        pending: metadata.backUrl,
      };

      payload.auto_return = 'approved';
    }

    const data = await this.request(
      '/checkout/preferences',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    return {
      preferenceId: data.id,
      initPoint: data.init_point,
    };
  }

  async getPaymentMethods() {
    return this.request('/v1/payment_methods');
  }

  async createCardPayment(payload, idempotencyKey) {
    return this.request('/v1/payments', {
      method: 'POST',

      headers: {
        'X-Idempotency-Key': idempotencyKey,
      },

      body: JSON.stringify(payload),
    });
  }

  async getPaymentDetails(paymentId) {
    return this.request(
      `/v1/payments/${encodeURIComponent(paymentId)}`
    );
  }
}

const mpClient = new MercadoPagoClient();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      size += chunk.length;

      if (size > 100 * 1024) {
        tooLarge = true;
        return;
      }

      body += chunk;
    });

    req.on('end', () => {
      if (tooLarge) {
        return reject(
          new HttpError(413, 'Requisição muito grande.')
        );
      }

      if (!body) return resolve({});

      try {
        const data = JSON.parse(body);

        if (
          !data ||
          typeof data !== 'object' ||
          Array.isArray(data)
        ) {
          throw new Error('Formato inválido');
        }

        resolve(data);
      } catch {
        reject(
          new HttpError(400, 'O corpo da requisição deve ser JSON válido.')
        );
      }
    });

    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });

  res.end(JSON.stringify(data));
}

function sendFile(res, filePath, headOnly = false) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
      });

      return res.end('Arquivo não encontrado');
    }

    res.writeHead(200, {
      'Content-Type':
        MIME_TYPES[path.extname(filePath).toLowerCase()] ||
        'application/octet-stream',
    });

    res.end(headOnly ? undefined : content);
  });
}

function texto(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function quantidade(value, campo) {
  const number = Number(value ?? 0);

  if (
    !Number.isSafeInteger(number) ||
    number < 0 ||
    number > 1000
  ) {
    throw new HttpError(
      400,
      `Quantidade inválida em ${campo}.`
    );
  }

  return number;
}

function syncInscricao(inscricao) {
  Promise.resolve()
    .then(() => sheetsSync.sincronizarInscricao(inscricao))
    .catch((error) => {
      console.error('[Planilha]', error.message);
    });
}

function syncStatus(chargeId) {
  Promise.resolve()
    .then(() =>
      sheetsSync.atualizarStatus(
        chargeId,
        'Confirmado (pago)'
      )
    )
    .catch((error) => {
      console.error('[Planilha]', error.message);
    });
}

function confirmarPagamentoMp(payment) {
  if (
    payment.status !== 'approved' ||
    !payment.external_reference
  ) {
    return false;
  }

  const inscricao = storage.getAll().find(
    (item) => item.customId === payment.external_reference
  );

  if (!inscricao) return false;

  const totalEsperado = Math.round(
    Number(inscricao.valorTotal) * 100
  );

  const totalPago = Math.round(
    Number(payment.transaction_amount) * 100
  );

  if (totalEsperado !== totalPago) {
    console.error(
      '[Pagamento] Valor divergente:',
      payment.id
    );

    return false;
  }

  storage.marcarComoPago(inscricao.chargeId);
  syncStatus(inscricao.chargeId);

  return true;
}

function getCheckoutSession(req) {
  const cookies = String(req.headers.cookie || '')
    .split(';')
    .map((item) => item.trim());

  const cookie = cookies.find(
    (item) => item.startsWith('cura_checkout=')
  );

  if (!cookie) return null;

  const sessionId = cookie.slice('cura_checkout='.length);
  const session = checkoutSessions.get(sessionId);

  if (!session) return null;

  if (session.expiresAt < Date.now()) {
    checkoutSessions.delete(sessionId);
    return null;
  }

  return session;
}

function createCheckoutSession(req, res, data) {
  const sessionId = crypto.randomBytes(32).toString('hex');

  checkoutSessions.set(sessionId, {
    ...data,
    expiresAt: Date.now() + SESSION_DURATION,
    processing: false,
    approved: false,
  });

  const secure =
    Boolean(req.socket.encrypted) ||
    process.env.PUBLIC_BASE_URL?.startsWith('https://');

  res.setHeader(
    'Set-Cookie',
    `cura_checkout=${sessionId}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=3600${secure ? '; Secure' : ''}`
  );
}

function baseUrl() {
  return (
    process.env.PUBLIC_BASE_URL ||
    `http://localhost:${PORT}`
  ).replace(/\/+$/, '');
}

function validarInscricao(body) {
  const responsavel = texto(body.responsavel);
  const email = texto(body.email);
  const whatsapp = texto(body.whatsapp).replace(/\D/g, '');

  if (
    responsavel.length < 3 ||
    responsavel.length > 200 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    !/^\d{10,11}$/.test(whatsapp)
  ) {
    throw new HttpError(
      400,
      'Confira nome, e-mail e WhatsApp com DDD.'
    );
  }

  let gateway = body.gateway;

  if (!gateway) {
    gateway = body.metodoPagamento === 'pix' || body.metodoPagamento === 'cartao'
      ? 'mercadopago'
      : 'mercadopago';
  }

  const qtdAdultos = quantidade(body.qtdAdultos, 'adultos');
  const qtdAlmocos = quantidade(body.qtdAlmocos, 'almoços');
  const qtdDoces = quantidade(body.qtdDoces || 0, 'doces');

  const valorTotal =
    qtdAdultos * PRECO_ADULTO +
    qtdAlmocos * PRECO_ALMOCO +
    qtdDoces * PRECO_DOCE;

  if (valorTotal <= 0) {
    throw new HttpError(
      400,
      'Selecione ao menos um ingresso ou item.'
    );
  }

  const adultosNomes = Array.isArray(body.adultosNomes)
    ? body.adultosNomes.map(texto)
    : [];

  if (
    adultosNomes.length !== Math.max(0, qtdAdultos - 1) ||
    adultosNomes.some(
      (nome) => nome.length < 3 || nome.length > 200
    )
  ) {
    throw new HttpError(
      400,
      'Informe os nomes dos demais adultos inscritos.'
    );
  }

  if (
    body.criancas !== undefined &&
    !Array.isArray(body.criancas)
  ) {
    throw new HttpError(400, 'Lista de crianças inválida.');
  }

  const criancas = (body.criancas || []).map((item) => {
    const nome = texto(item?.nome);
    const idade = item?.idade;

    if (
      nome.length < 2 ||
      nome.length > 200 ||
      !Number.isInteger(idade) ||
      idade < 0 ||
      idade > 11
    ) {
      throw new HttpError(
        400,
        'Confira os nomes e idades das crianças.'
      );
    }

    return { nome, idade };
  });

  const disponibilidade = storage.getDisponibilidade();
  const bebes = criancas.filter((c) => c.idade <= 2).length;
  const kids = criancas.filter((c) => c.idade >= 3).length;

  if (
    qtdAdultos > disponibilidade.adultosRestantes ||
    qtdAlmocos > disponibilidade.almocosRestantes ||
    bebes > disponibilidade.bebesRestantes ||
    kids > disponibilidade.criancasRestantes
  ) {
    throw new HttpError(
      409,
      'Não há vagas suficientes. Atualize a página e confira a disponibilidade.'
    );
  }

  return {
    responsavel,
    email,
    whatsapp,
    gateway,
    qtdAdultos,
    adultosNomes,
    qtdAlmocos,
    qtdDoces,
    criancas,
    valorTotal,
  };
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      Allow: 'GET, HEAD, POST, OPTIONS',
    });

    return res.end();
  }

  try {
    if (
      pathname === '/api/disponibilidade' &&
      method === 'GET'
    ) {
      return sendJson(res, 200, {
        ok: true,
        ...storage.getDisponibilidade(),

        precos: {
          adulto: PRECO_ADULTO,
          almoco: PRECO_ALMOCO,
          doce: PRECO_DOCE,
          crianca: 0,
        },

        gatewaysDisponiveis: {
          efi: false,
          mercadopago: Boolean(
            mpClient.accessToken &&
            texto(process.env.MERCADO_PAGO_PUBLIC_KEY)
          ),
        },
      });
    }

    if (
      pathname === '/api/config/mp' &&
      method === 'GET'
    ) {
      return sendJson(res, 200, {
        ok: true,
        publicKey: process.env.MERCADO_PAGO_PUBLIC_KEY || '',
      });
    }

    if (
      pathname === '/api/inscricao' &&
      method === 'POST'
    ) {
      const body = await parseBody(req);
      const pedido = validarInscricao(body);
      const customId = `cura_${crypto.randomUUID()}`;

      if (
        !mpClient.accessToken ||
        !texto(process.env.MERCADO_PAGO_PUBLIC_KEY)
      ) {
        throw new HttpError(
          503,
          'Pagamento com Mercado Pago não configurado.'
        );
      }

      const items = [];

      if (pedido.qtdAdultos > 0) {
        items.push({
          title: 'Imersão Adulto',
          quantity: pedido.qtdAdultos,
          unit_price: PRECO_ADULTO,
        });
      }

      if (pedido.qtdAlmocos > 0) {
        items.push({
          title: 'Almoço',
          quantity: pedido.qtdAlmocos,
          unit_price: PRECO_ALMOCO,
        });
      }

      if (pedido.qtdDoces > 0) {
        items.push({
          title: 'Doce de Teste',
          quantity: pedido.qtdDoces,
          unit_price: PRECO_DOCE,
        });
      }

      const rawMpNotif = process.env.MERCADO_PAGO_NOTIFICATION_URL || `${baseUrl()}/api/webhook/mercadopago`;
      const mpNotificationUrl = rawMpNotif.startsWith('https://') ? rawMpNotif : undefined;

      const isPix = body.metodoPagamento === 'pix' || pedido.gateway === 'pix';

      const preferenceOptions = {
        externalReference: customId,
        notificationUrl: mpNotificationUrl,
        backUrl: `${baseUrl()}/inscricao.html`,
      };

      const result = await mpClient.createPreference(
        items,
        {
          name: pedido.responsavel,
          email: pedido.email,
          phone: pedido.whatsapp,
        },
        preferenceOptions
      );

      const paymentUrl = result.initPoint;
      const chargeId = result.preferenceId;
      const formaPagamento = isPix ? 'Mercado Pago (Pix)' : 'Mercado Pago (Cartão)';

      if (!chargeId || !paymentUrl) {
        throw new Error(
          'O Mercado Pago não retornou os dados da cobrança.'
        );
      }

      const novaInscricao = storage.addInscricao({
        responsavel: pedido.responsavel,
        email: pedido.email,
        whatsapp: pedido.whatsapp,
        qtdAdultos: pedido.qtdAdultos,
        adultosNomes: pedido.adultosNomes,
        qtdAlmocos: pedido.qtdAlmocos,
        qtdDoces: pedido.qtdDoces,
        criancas: pedido.criancas,
        valorTotal: pedido.valorTotal,
        chargeId,
        customId,
        paymentUrl,
        formaPagamento,
      });

      syncInscricao(novaInscricao);

      createCheckoutSession(req, res, {
        customId,
        chargeId,
        valorTotal: pedido.valorTotal,
        email: pedido.email,
      });

      return sendJson(res, 200, {
        ok: true,
        paymentUrl,
        chargeId,
        customId,
        total: pedido.valorTotal,
      });
    }

    if (
      pathname === '/api/process_payment' &&
      method === 'POST'
    ) {
      const session = getCheckoutSession(req);

      if (!session) {
        throw new HttpError(
          401,
          'Checkout expirado. Inicie novamente a inscrição.'
        );
      }

      if (session.approved) {
        throw new HttpError(
          409,
          'Esta inscrição já possui pagamento aprovado.'
        );
      }

      if (session.processing) {
        throw new HttpError(
          409,
          'Já existe um pagamento em processamento.'
        );
      }

      const body = await parseBody(req);
      const token = texto(body.token);
      const paymentMethodId = texto(body.payment_method_id);
      const installments = Number(body.installments || 1);

      if (
        !token ||
        token.length > 500 ||
        !paymentMethodId ||
        !Number.isInteger(installments) ||
        installments < 1 ||
        installments > 12
      ) {
        throw new HttpError(
          400,
          'Confira os dados do cartão e o parcelamento.'
        );
      }

      session.processing = true;

      try {
        const payload = {
          token,
          payment_method_id: paymentMethodId,
          installments,
          transaction_amount: session.valorTotal,
          description: 'Inscrição — Imersão de Cura',
          external_reference: session.customId,

          payer: {
            email: session.email,
          },
        };

        if (body.issuer_id) {
          payload.issuer_id = String(body.issuer_id);
        }

        const identification = body.payer?.identification;

        if (
          identification &&
          texto(identification.type) &&
          texto(identification.number)
        ) {
          payload.payer.identification = {
            type: texto(identification.type),
            number: texto(identification.number),
          };
        }

        const rawMpNotif = process.env.MERCADO_PAGO_NOTIFICATION_URL || `${baseUrl()}/api/webhook/mercadopago`;
        if (rawMpNotif.startsWith('https://')) {
          payload.notification_url = rawMpNotif;
        }

        const idempotencyKey = crypto
          .createHash('sha256')
          .update(`${session.customId}:${token}`)
          .digest('hex');

        const payment = await mpClient.createCardPayment(
          payload,
          idempotencyKey
        );

        if (payment.status === 'approved') {
          session.approved = true;
          confirmarPagamentoMp(payment);
        }

        return sendJson(res, 200, {
          success: payment.status === 'approved',
          id: payment.id,
          status: payment.status,
          status_detail: payment.status_detail,
        });
      } finally {
        session.processing = false;
      }
    }

    if (
      (
        pathname === '/api/webhook/mercadopago' ||
        pathname === '/api/webhook/mp'
      ) &&
      method === 'POST'
    ) {
      const body = await parseBody(req);

      const topic =
        body.type ||
        body.topic ||
        parsedUrl.query.type ||
        parsedUrl.query.topic;

      const paymentId =
        body.data?.id ||
        parsedUrl.query['data.id'] ||
        (
          topic === 'payment'
            ? body.id || parsedUrl.query.id
            : null
        );

      if (
        paymentId &&
        (!topic || topic === 'payment') &&
        /^\d+$/.test(String(paymentId))
      ) {
        const payment =
          await mpClient.getPaymentDetails(paymentId);

        confirmarPagamentoMp(payment);
      }

      return sendJson(res, 200, { ok: true });
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, {
        ok: false,
        error: 'Rota da API não encontrada.',
      });
    }

    if (!['GET', 'HEAD'].includes(method)) {
      return sendJson(res, 405, {
        ok: false,
        error: 'Método não permitido.',
      });
    }

    let decodedPath;

    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      throw new HttpError(400, 'Endereço inválido.');
    }

    const relativePath = decodedPath === '/'
      ? 'index.html'
      : decodedPath.replace(/^\/+/, '');

    const filePath = path.resolve(PUBLIC_DIR, relativePath);

    if (
      filePath !== PUBLIC_DIR &&
      !filePath.startsWith(PUBLIC_DIR + path.sep)
    ) {
      throw new HttpError(403, 'Acesso não permitido.');
    }

    sendFile(res, filePath, method === 'HEAD');
  } catch (error) {
    console.error('[Servidor]', error.message);

    if (!res.headersSent) {
      sendJson(res, error.statusCode || 500, {
        ok: false,
        error: error.statusCode
          ? error.message
          : 'Não foi possível concluir a operação. Confira o terminal do servidor.',
      });
    } else {
      res.end();
    }
  }
});

const cleanupTimer = setInterval(() => {
  const now = Date.now();

  for (const [id, session] of checkoutSessions) {
    if (session.expiresAt < now && !session.processing) {
      checkoutSessions.delete(id);
    }
  }
}, 60 * 1000);

cleanupTimer.unref();

server.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}.`);
  console.log('Pagamentos integrados via Mercado Pago (Pix e Cartão).');
});

module.exports = server;