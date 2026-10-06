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
const PRECO_DOCE = 1.0;
const PUBLIC_DIR = path.resolve(__dirname, 'public');

const STATUS_PENDENTE = 'Aguardando pagamento';
const STATUS_PAGO = 'Confirmado (pago)';
const REF_REGEX = /^cura_[0-9a-f-]{36}$/i;

// Contexto temporário do checkout (memória). Some se o Render reiniciar.
const checkoutSessions = new Map();
const SESSION_DURATION = 60 * 60 * 1000;

// Cache curto para não consultar o Mercado Pago a cada requisição de status.
const statusCache = new Map();
const STATUS_CACHE_MS = 3000;

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

    // Dados compactos do pedido, para recuperar após reinício do servidor.
    if (metadata.orderMetadata) {
      payload.metadata = metadata.orderMetadata;
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

  async searchPaymentsByReference(externalReference) {
    const qs = new URLSearchParams({
      external_reference: externalReference,
      sort: 'date_created',
      criteria: 'desc',
      limit: '10',
    });

    const data = await this.request(`/v1/payments/search?${qs}`);
    return data.results || [];
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
          new HttpError(
            400,
            'O corpo da requisição deve ser JSON válido.'
          )
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

function calcularTotal(qtdAdultos, qtdAlmocos, qtdDoces) {
  return (
    qtdAdultos * PRECO_ADULTO +
    qtdAlmocos * PRECO_ALMOCO +
    qtdDoces * PRECO_DOCE
  );
}

function dataHoraBr() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  });
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
    .then(() => sheetsSync.atualizarStatus(chargeId, STATUS_PAGO))
    .catch((error) => {
      console.error('[Planilha]', error.message);
    });
}

// ---------------- DADOS DO PEDIDO NO MERCADO PAGO ----------------

// Guarda os dados essenciais no próprio pagamento. Se o Render reiniciar
// e apagar a memória, o pedido ainda pode ser reconstruído.
function montarMetaPedido(pedido) {
  const json = JSON.stringify({
    r: pedido.responsavel,
    e: pedido.email,
    w: pedido.whatsapp,
    a: pedido.qtdAdultos,
    an: pedido.adultosNomes,
    l: pedido.qtdAlmocos,
    d: pedido.qtdDoces,
    c: pedido.criancas.map((c) => [c.nome, c.idade]),
  });

  if (json.length > 1500) {
    console.warn(
      '[Pedido] Dados grandes demais para o metadata do Mercado Pago.'
    );
    return null;
  }

  return json;
}

function lerMetaPedido(payment) {
  const raw = payment?.metadata?.pedido;
  if (typeof raw !== 'string') return null;

  try {
    const m = JSON.parse(raw);

    const qtdAdultos = Number(m.a) || 0;
    const qtdAlmocos = Number(m.l) || 0;
    const qtdDoces = Number(m.d) || 0;

    return {
      responsavel: texto(m.r),
      email: texto(m.e),
      whatsapp: texto(m.w),
      qtdAdultos,
      adultosNomes: Array.isArray(m.an) ? m.an.map(texto) : [],
      qtdAlmocos,
      qtdDoces,
      criancas: Array.isArray(m.c)
        ? m.c.map(([nome, idade]) => ({
            nome: texto(nome),
            idade: Number(idade),
          }))
        : [],
      valorTotal: calcularTotal(qtdAdultos, qtdAlmocos, qtdDoces),
    };
  } catch {
    return null;
  }
}

function descreverFormaPagamento(payment) {
  if (payment.payment_method_id === 'pix') {
    return 'Mercado Pago (Pix)';
  }

  if (payment.payment_type_id === 'credit_card') {
    return 'Mercado Pago (Cartão de crédito)';
  }

  if (payment.payment_type_id === 'debit_card') {
    return 'Mercado Pago (Cartão de débito)';
  }

  return 'Mercado Pago';
}

function encontrarSessaoPorRef(ref) {
  for (const [id, session] of checkoutSessions) {
    if (session.customId === ref) return { id, session };
  }

  return null;
}

// ---------------- CONFIRMAÇÃO DO PAGAMENTO ----------------

// Pode ser chamada várias vezes (cartão, webhook, consulta de status).
// Não há "await" entre a verificação e o registro, então no mesmo
// processo ela não cria duas inscrições para o mesmo pagamento.
async function confirmarPagamentoMp(payment) {
  if (
    !payment ||
    payment.status !== 'approved' ||
    payment.currency_id !== 'BRL' ||
    !REF_REGEX.test(String(payment.external_reference || ''))
  ) {
    return false;
  }

  const ref = payment.external_reference;

  const existente = storage
    .getAll()
    .find((item) => item.customId === ref);

  if (existente) {
    if (existente.status !== STATUS_PAGO) {
      storage.marcarComoPago(existente.chargeId);
      syncStatus(existente.chargeId);
    }

    return true;
  }

  const encontrada = encontrarSessaoPorRef(ref);

  let pedido;
  let chargeId;
  let paymentUrl = '';
  let observacao = '';
  let validarValor = true;

  if (encontrada) {
    pedido = encontrada.session.pedido;
    chargeId = encontrada.session.chargeId;
    paymentUrl = encontrada.session.paymentUrl || '';
  } else {
    const meta = lerMetaPedido(payment);
    chargeId = String(payment.id);

    if (meta && meta.responsavel && meta.email) {
      console.log(`[Pedido] Recuperado pelo metadata: ${ref}`);
      pedido = meta;
    } else {
      console.warn(`[Pedido] Sem dados completos para ${ref}.`);

      validarValor = false;
      observacao =
        'Dados reconstruídos pelo pagador do Mercado Pago. Conferir manualmente.';

      pedido = {
        responsavel:
          [payment.payer?.first_name, payment.payer?.last_name]
            .filter(Boolean)
            .join(' ') || 'Participante',

        email: payment.payer?.email || '',

        whatsapp: [
          payment.payer?.phone?.area_code,
          payment.payer?.phone?.number,
        ]
          .filter(Boolean)
          .join(''),

        qtdAdultos: 0,
        adultosNomes: [],
        qtdAlmocos: 0,
        qtdDoces: 0,
        criancas: [],
        valorTotal: Number(payment.transaction_amount || 0),
      };
    }
  }

  if (validarValor) {
    const esperado = Math.round(Number(pedido.valorTotal) * 100);
    const pago = Math.round(Number(payment.transaction_amount) * 100);

    if (esperado !== pago) {
      console.error(
        `[Pagamento] Valor divergente. Pedido: ${esperado}, pago: ${pago}, id: ${payment.id}`
      );

      return false;
    }
  }

  const novaInscricao = storage.addInscricao({
    ...pedido,
    chargeId,
    customId: ref,
    paymentId: String(payment.id),
    paymentUrl,
    formaPagamento: descreverFormaPagamento(payment),
    observacao,
    status: STATUS_PAGO,
  });

  if (encontrada) {
    encontrada.session.approved = true;
    checkoutSessions.delete(encontrada.id);
  }

  // upsertRow atualiza a mesma linha criada como pendente na inscrição.
  syncInscricao(novaInscricao);
  return true;
}

// ---------------- SESSÃO DO CHECKOUT ----------------

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
    req.headers['x-forwarded-proto'] === 'https' ||
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

function notificationUrlMp() {
  const raw = (
    process.env.MERCADO_PAGO_NOTIFICATION_URL ||
    `${baseUrl()}/api/webhook/mercadopago`
  ).trim();

  return raw.startsWith('https://') ? raw : undefined;
}

// ---------------- VALIDAÇÃO DA INSCRIÇÃO ----------------

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

  const qtdAdultos = quantidade(body.qtdAdultos, 'adultos');
  const qtdAlmocos = quantidade(body.qtdAlmocos, 'almoços');
  const qtdDoces = quantidade(body.qtdDoces || 0, 'doces');

  const valorTotal = calcularTotal(
    qtdAdultos,
    qtdAlmocos,
    qtdDoces
  );

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
    gateway: 'mercadopago',
    qtdAdultos,
    adultosNomes,
    qtdAlmocos,
    qtdDoces,
    criancas,
    valorTotal,
  };
}

// ---------------- WEBHOOK ----------------

async function processarWebhookMp(body, query) {
  const topic =
    body.type ||
    body.topic ||
    query.type ||
    query.topic;

  // Outros tópicos (ex.: merchant_order) não trazem o id do pagamento.
  if (topic && topic !== 'payment') return;

  let paymentId =
    body.data?.id ||
    query['data.id'] ||
    (topic === 'payment' ? body.id || query.id : null);

  if (!paymentId && topic === 'payment' && body.resource) {
    const parts = String(body.resource).split('/');
    paymentId = parts[parts.length - 1];
  }

  if (!paymentId || !/^\d+$/.test(String(paymentId))) return;

  // Consulta o Mercado Pago antes de confirmar qualquer coisa.
  const payment = await mpClient.getPaymentDetails(paymentId);
  await confirmarPagamentoMp(payment);
}

// ---------------- ADMIN ----------------

// Compara a chave em tempo constante, para não vazar diferenças.
function chaveAdminValida(enviada) {
  const esperada = process.env.ADMIN_KEY || '';
  if (!esperada || !enviada) return false;

  const a = crypto.createHash('sha256').update(String(enviada)).digest();
  const b = crypto.createHash('sha256').update(esperada).digest();

  return crypto.timingSafeEqual(a, b);
}

// ---------------- SERVIDOR ----------------

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
    if (pathname === '/health' && ['GET', 'HEAD'].includes(method)) {
      return sendJson(res, 200, { ok: true });
    }

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

    // Consulta ativa: não depende do webhook chegar.
    if (
      pathname === '/api/status' &&
      method === 'GET'
    ) {
      const ref = texto(parsedUrl.query.ref);

      if (!REF_REGEX.test(ref)) {
        throw new HttpError(400, 'Referência inválida.');
      }

      const cached = statusCache.get(ref);

      if (cached && Date.now() - cached.at < STATUS_CACHE_MS) {
        return sendJson(res, 200, cached.payload);
      }

      const jaConfirmada = storage
        .getAll()
        .find(
          (item) =>
            item.customId === ref && item.status === STATUS_PAGO
        );

      let payload;

      if (jaConfirmada) {
        payload = { ok: true, status: 'approved', detail: null };
      } else {
        const payments =
          await mpClient.searchPaymentsByReference(ref);

        const aprovado = payments.find(
          (p) => p.status === 'approved'
        );

        if (aprovado) await confirmarPagamentoMp(aprovado);

        const atual = aprovado || payments[0];

        payload = {
          ok: true,
          status: atual?.status || 'pending',
          detail: atual?.status_detail || null,
        };
      }

      statusCache.set(ref, { at: Date.now(), payload });
      return sendJson(res, 200, payload);
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

      const metaPedido = montarMetaPedido(pedido);

      const result = await mpClient.createPreference(
        items,
        {
          name: pedido.responsavel,
          email: pedido.email,
          phone: pedido.whatsapp,
        },
        {
          externalReference: customId,
          notificationUrl: notificationUrlMp(),
          backUrl: `${baseUrl()}/inscricao.html`,
          orderMetadata: metaPedido
            ? { pedido: metaPedido }
            : undefined,
        }
      );

      const paymentUrl = result.initPoint;
      const chargeId = result.preferenceId;

      if (!chargeId || !paymentUrl) {
        throw new Error(
          'O Mercado Pago não retornou os dados da cobrança.'
        );
      }

      // Só vai para o storage (e para as vagas) quando o pagamento for aprovado.
      createCheckoutSession(req, res, {
        customId,
        chargeId,
        paymentUrl,
        formaPagamento: 'Mercado Pago',
        metaPedido,
        pedido,
      });

      // Registra na planilha como pendente, sem ocupar vagas.
      // A mesma linha vira "Confirmado (pago)" pelo upsertRow.
      syncInscricao({
        dataHora: dataHoraBr(),
        ...pedido,
        chargeId,
        customId,
        paymentId: '',
        paymentUrl,
        formaPagamento: 'Mercado Pago',
        observacao: '',
        status: STATUS_PENDENTE,
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
      const ehPix = paymentMethodId === 'pix';
      const installments = ehPix ? 1 : Number(body.installments || 1);

      if (
        !paymentMethodId ||
        (!ehPix && (!token || token.length > 500)) ||
        !Number.isInteger(installments) ||
        installments < 1 ||
        installments > 12
      ) {
        throw new HttpError(
          400,
          'Confira os dados do pagamento.'
        );
      }

      session.processing = true;

      try {
        const payload = {
          payment_method_id: paymentMethodId,
          transaction_amount: session.pedido.valorTotal,
          description: 'Inscrição — Imersão de Cura',
          external_reference: session.customId,

          payer: {
            email: session.pedido.email,
          },
        };

        if (!ehPix) {
          payload.token = token;
          payload.installments = installments;
        }

        if (session.metaPedido) {
          payload.metadata = { pedido: session.metaPedido };
        }

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

        const notificationUrl = notificationUrlMp();

        if (notificationUrl) {
          payload.notification_url = notificationUrl;
        }

        // Pix usa chave fixa: clicar duas vezes devolve o mesmo QR Code.
        const idempotencyKey = crypto
          .createHash('sha256')
          .update(
            `${session.customId}:${ehPix ? 'pix' : token}`
          )
          .digest('hex');

        const payment = await mpClient.createCardPayment(
          payload,
          idempotencyKey
        );

        if (payment.status === 'approved') {
          await confirmarPagamentoMp(payment);
        }

        const dadosPix =
          payment.point_of_interaction?.transaction_data;

        return sendJson(res, 200, {
          success: payment.status === 'approved',
          id: payment.id,
          status: payment.status,
          status_detail: payment.status_detail,
          customId: session.customId,

          pix: dadosPix
            ? {
                qr_code: dadosPix.qr_code,
                qr_code_base64: dadosPix.qr_code_base64,
                ticket_url: dadosPix.ticket_url,
              }
            : undefined,
        });
      } finally {
        session.processing = false;
      }
    }

    // Reenvia as inscrições do storage para a planilha (recuperação).
    if (
      pathname === '/api/admin/resync' &&
      method === 'POST'
    ) {
      if (!chaveAdminValida(req.headers['x-admin-key'])) {
        throw new HttpError(401, 'Não autorizado.');
      }

      const lista = storage.getAll();
      sendJson(res, 200, { ok: true, total: lista.length });

      (async () => {
        for (const item of lista) {
          await sheetsSync.sincronizarInscricao(item);
        }

        console.log(`[Resync] ${lista.length} inscrições reenviadas.`);
      })().catch((erro) => {
        console.error('[Resync]', erro.message);
      });

      return;
    }

    if (
      (
        pathname === '/api/webhook/mercadopago' ||
        pathname === '/api/webhook/mp'
      ) &&
      method === 'POST'
    ) {
      const body = await parseBody(req);

      // Responde na hora (o Mercado Pago espera poucos segundos).
      sendJson(res, 200, { ok: true });

      processarWebhookMp(body, parsedUrl.query).catch((error) => {
        console.error('[Webhook MP]', error.message);
      });

      return;
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

  for (const [ref, entry] of statusCache) {
    if (now - entry.at > 60 * 1000) statusCache.delete(ref);
  }
}, 60 * 1000);

cleanupTimer.unref();

server.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}.`);
  console.log('Pagamentos integrados via Mercado Pago (Pix e Cartão).');
});

module.exports = server;