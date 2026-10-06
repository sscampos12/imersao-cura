/**
 * Frontend — Carrinho e inscrição da Imersão de Cura
 * Pagamentos via Mercado Pago: Pix (QR Code no site) e Cartão de Crédito (Brick)
 */

const PRECO_ADULTO = 40;
const PRECO_ALMOCO = 25;
const PRECO_DOCE = 1.0;

// Acréscimo cobrado no cartão, para repassar a tarifa do Mercado Pago.
// Precisa ser igual à TAXA_CARTAO do server.js.
const TAXA_CARTAO = 0.05;

function valorCartao(valorBase) {
  return Math.round(Number(valorBase) * (1 + TAXA_CARTAO) * 100) / 100;
}

function totalExibido() {
  const base = totalCarrinho();
  return state.gateway === 'mercadopago' ? valorCartao(base) : base;
}

const CHAVE_PEDIDO = 'cura_pedido_pendente';
const VALIDADE_PEDIDO_MS = 2 * 60 * 60 * 1000;
const LIMITE_ACOMPANHAMENTO_MS = 30 * 60 * 1000;

let checkoutBrickController = null;
let enviandoPedido = false;
let carregandoCheckout = false;

let refPedidoAtual = null;
let refAcompanhada = null;
let pollTimer = null;
let pollAtivo = false;

const state = {
  qtdAdultos: 1,
  adultosNomes: [],
  qtdAlmocos: 0,
  qtdDoces: 0,
  criancas: [],
  gateway: 'pix',

  disponibilidade: {
    adultosRestantes: 120,
    almocosRestantes: 50,
    criancasRestantes: 20,
    bebesRestantes: 6,
    gatewaysDisponiveis: {
      mercadopago: true,
    },
  },
};

const formatMoney = (val) =>
  `R$ ${Number(val).toFixed(2).replace('.', ',')}`;

const bloqueado = () => enviandoPedido || carregandoCheckout;

function totalCarrinho() {
  return (
    state.qtdAdultos * PRECO_ADULTO +
    state.qtdAlmocos * PRECO_ALMOCO +
    (state.qtdDoces || 0) * PRECO_DOCE
  );
}

// Pix e cartão dependem da mesma integração (Mercado Pago).
function gatewayDisponivel() {
  return Boolean(
    state.disponibilidade.gatewaysDisponiveis?.mercadopago ?? true
  );
}

function atualizarBotaoCheckout() {
  const btn = document.getElementById('btnSubmit');
  const texto = document.getElementById('btnSubmitText');
  const spinner = document.getElementById('btnSpinner');

  if (!btn) return;

  const ocupado = bloqueado();
  const temPagamento = totalCarrinho() > 0;
  const brickAtivo =
    state.gateway === 'mercadopago' &&
    Boolean(checkoutBrickController);

  btn.disabled = ocupado || !temPagamento || !gatewayDisponivel();
  btn.style.display = brickAtivo ? 'none' : '';

  if (spinner) {
    spinner.style.display = ocupado ? 'inline-block' : 'none';
  }

  if (texto) {
    texto.textContent = ocupado
      ? 'Processando...'
      : !gatewayDisponivel()
        ? 'Pagamento Indisponível'
        : state.gateway === 'pix'
          ? 'Finalizar Inscrição e Pagar com Pix'
          : 'Continuar para Pagamento com Cartão';
  }
}

function bloquearSelecaoPagamento(bloquear) {
  document
    .querySelectorAll('input[name="paymentGateway"]')
    .forEach((input) => {
      input.disabled = bloquear || !gatewayDisponivel();
    });
}

// ---------------- DISPONIBILIDADE ----------------

async function carregarDisponibilidade() {
  try {
    const res = await fetch('/api/disponibilidade');

    if (!res.ok) {
      throw new Error('Não foi possível consultar a disponibilidade.');
    }

    const data = await res.json();

    state.disponibilidade = {
      ...state.disponibilidade,
      ...data,
      gatewaysDisponiveis:
        data.gatewaysDisponiveis ||
        state.disponibilidade.gatewaysDisponiveis,
    };
  } catch (err) {
    console.warn('Usando limites padrão locais:', err);
  }

  atualizarBadges();
  configurarGateways();
}

function configurarGateways() {
  const container = document.getElementById('gatewayContainer');

  if (container) container.style.display = 'block';

  const opacidade = gatewayDisponivel() ? '1' : '0.45';

  const cardPix = document.getElementById('cardOptPix');
  const cardMp = document.getElementById('cardOptMp');

  if (cardPix) {
    cardPix.style.opacity = opacidade;
    cardPix.title = 'Pagamento via Pix, sem acréscimo';
  }

  if (cardMp) {
    cardMp.style.opacity = opacidade;
    cardMp.title = 'Cartão de crédito via Mercado Pago, com acréscimo de 5%';
  }

  bloquearSelecaoPagamento(bloqueado());
  trcarVisualGateway();
}

function trocarGateway(gw) {
  if (bloqueado()) {
    trcarVisualGateway();
    return;
  }

  if (!['pix', 'mercadopago'].includes(gw)) return;

  state.gateway = gw;
  trcarVisualGateway();
  // Atualiza o total e a linha de acréscimo conforme a forma escolhida.
  atualizarCarrinho();
}

// Nome mantido para compatibilidade com o código original.
function trcarVisualGateway() {
  document
    .querySelectorAll('input[name="paymentGateway"]')
    .forEach((input) => {
      input.checked = input.value === state.gateway;
    });

  document.getElementById('cardOptPix')?.classList.toggle(
    'selected',
    state.gateway === 'pix'
  );

  document.getElementById('cardOptMp')?.classList.toggle(
    'selected',
    state.gateway === 'mercadopago'
  );

  const notice = document.getElementById('gatewayNotice');

  if (notice) {
    notice.textContent = state.gateway === 'pix'
      ? 'Pix: sem acréscimo. Processado com segurança pelo Mercado Pago.'
      : 'Cartão: acréscimo de 5% referente à tarifa de processamento. Se parcelar, o juro é seu.';
  }

  const container = document.getElementById('paymentBrick_container');

  if (container) {
    container.style.display =
      state.gateway === 'mercadopago' && checkoutBrickController
        ? 'block'
        : 'none';
  }

  atualizarBotaoCheckout();
}

function atualizarBadges() {
  const d = state.disponibilidade;

  const bAdultos = document.getElementById('badgeAdultos');
  const bAlmocos = document.getElementById('badgeAlmocos');
  const bKids = document.getElementById('badgeKids');

  if (bAdultos) bAdultos.textContent = `${d.adultosRestantes} restantes`;
  if (bAlmocos) bAlmocos.textContent = `${d.almocosRestantes} restantes`;

  if (bKids) {
    bKids.textContent =
      `${Number(d.criancasRestantes) + Number(d.bebesRestantes)} vagas`;
  }

  const sAdultos = document.getElementById('stockAdultos');

  if (sAdultos) {
    sAdultos.textContent = `${d.adultosRestantes} de 120 vagas disponíveis`;
  }

  const sAlmocos = document.getElementById('stockAlmocos');

  if (sAlmocos) {
    sAlmocos.textContent = Number(d.almocosRestantes) === 0
      ? '❌ Almoços ESGOTADOS'
      : `${d.almocosRestantes} de 50 almoços disponíveis`;
  }

  const pBebes = document.getElementById('pillBebes');
  if (pBebes) pBebes.textContent = `Bebês (0-2a): ${d.bebesRestantes} vagas`;

  const pCriancas = document.getElementById('pillCriancas');

  if (pCriancas) {
    pCriancas.textContent = `Kids (3-11a): ${d.criancasRestantes} vagas`;
  }

  const btnPlusAlmoco = document.getElementById('btnPlusAlmoco');

  if (btnPlusAlmoco) {
    btnPlusAlmoco.disabled =
      state.qtdAlmocos >= Number(d.almocosRestantes);
  }

  const btnPlusAdulto = document.getElementById('btnPlusAdulto');

  if (btnPlusAdulto) {
    btnPlusAdulto.disabled =
      state.qtdAdultos >= Number(d.adultosRestantes);
  }
}

// ---------------- CONTROLE DE ADULTOS ----------------

function alterarAdultos(delta) {
  if (bloqueado()) return;

  const novaQtd = state.qtdAdultos + delta;

  if (novaQtd < 0) return;

  if (novaQtd > state.disponibilidade.adultosRestantes) {
    alert(
      `Desculpe, restam apenas ${state.disponibilidade.adultosRestantes} vagas para adultos.`
    );
    return;
  }

  state.qtdAdultos = novaQtd;

  document.getElementById('qtdAdultosDisplay').textContent =
    state.qtdAdultos;

  document.getElementById('cardAdulto')?.classList.toggle(
    'selected',
    state.qtdAdultos > 0
  );

  renderizarInputsAdultosExtras();
  atualizarCarrinho();
  atualizarBadges();
}

function renderizarInputsAdultosExtras() {
  const container = document.getElementById('extraAdultsContainer');
  const inputsDiv = document.getElementById('extraAdultsInputs');

  if (state.qtdAdultos <= 1) {
    container.style.display = 'none';
    state.adultosNomes = [];
    inputsDiv.innerHTML = '';
    return;
  }

  container.style.display = 'block';

  const qtdExtras = state.qtdAdultos - 1;

  while (state.adultosNomes.length < qtdExtras) {
    state.adultosNomes.push('');
  }

  state.adultosNomes = state.adultosNomes.slice(0, qtdExtras);
  inputsDiv.innerHTML = '';

  for (let i = 0; i < qtdExtras; i++) {
    const row = document.createElement('div');
    row.className = 'extra-adult-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = `Nome completo do ${i + 2}º Adulto *`;
    input.value = state.adultosNomes[i] || '';
    input.required = true;

    input.addEventListener('input', () => {
      atualizarNomeAdultoExtra(i, input.value);
    });

    row.appendChild(input);
    inputsDiv.appendChild(row);
  }
}

function atualizarNomeAdultoExtra(idx, val) {
  state.adultosNomes[idx] = val;
}

// ---------------- CONTROLE DE ALMOÇOS ----------------

function alterarAlmocos(delta) {
  if (bloqueado()) return;

  const novaQtd = state.qtdAlmocos + delta;

  if (novaQtd < 0) return;

  if (novaQtd > state.disponibilidade.almocosRestantes) {
    alert(
      `Desculpe, restam apenas ${state.disponibilidade.almocosRestantes} almoços disponíveis.`
    );
    return;
  }

  state.qtdAlmocos = novaQtd;

  document.getElementById('qtdAlmocosDisplay').textContent =
    state.qtdAlmocos;

  document.getElementById('cardAlmoco')?.classList.toggle(
    'selected',
    state.qtdAlmocos > 0
  );

  atualizarCarrinho();
  atualizarBadges();
}

// ---------------- CONTROLE DE DOCES (TESTE) ----------------

function alterarDoces(delta) {
  if (bloqueado()) return;

  const novaQtd = (state.qtdDoces || 0) + delta;

  if (novaQtd < 0) return;

  state.qtdDoces = novaQtd;

  const display = document.getElementById('qtdDocesDisplay');
  if (display) display.textContent = state.qtdDoces;

  atualizarCarrinho();
}

// ---------------- ESPAÇO KIDS ----------------

function adicionarCrianca() {
  if (bloqueado()) return;

  const vagas =
    Number(state.disponibilidade.criancasRestantes) +
    Number(state.disponibilidade.bebesRestantes);

  if (state.criancas.length >= vagas) {
    alert('Desculpe, não há mais vagas disponíveis no Espaço Kids.');
    return;
  }

  state.criancas.push({
    id: Date.now() + Math.random(),
    nome: '',
    idade: Number(state.disponibilidade.criancasRestantes) > 0 ? 5 : 0,
  });

  renderizarCriancas();
  atualizarCarrinho();
}

function removerCrianca(index) {
  if (bloqueado()) return;

  state.criancas.splice(index, 1);
  renderizarCriancas();
  atualizarCarrinho();
}

function renderizarCriancas() {
  const container = document.getElementById('criancasContainer');
  container.innerHTML = '';

  state.criancas.forEach((c, index) => {
    const row = document.createElement('div');
    row.className = 'kid-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Nome da criança *';
    input.value = c.nome || '';
    input.required = true;

    input.addEventListener('input', () => {
      state.criancas[index].nome = input.value;
    });

    const select = document.createElement('select');

    for (let age = 0; age <= 11; age++) {
      const option = document.createElement('option');
      option.value = age;

      const idadeTexto = age === 0
        ? 'Bebê (< 1 ano)'
        : age === 1
          ? '1 ano'
          : `${age} anos`;

      option.textContent = `${idadeTexto} ${age <= 2 ? '(Bebê)' : '(Kids)'}`;
      option.selected = c.idade === age;
      select.appendChild(option);
    }

    select.addEventListener('change', () => {
      state.criancas[index].idade = Number(select.value);
      atualizarCarrinho();
    });

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-remove-kid';
    button.title = 'Remover';
    button.textContent = '✕';

    button.addEventListener('click', () => removerCrianca(index));

    row.append(input, select, button);
    container.appendChild(row);
  });
}

// ---------------- ATUALIZAÇÃO DO CARRINHO ----------------

async function invalidarCheckoutCartao() {
  const controller = checkoutBrickController;
  checkoutBrickController = null;

  atualizarBotaoCheckout();

  const container = document.getElementById('paymentBrick_container');
  if (container) container.style.display = 'none';

  if (controller) {
    try {
      await controller.unmount();
    } catch (error) {
      console.warn('Erro ao desmontar o checkout:', error);
    }
  }
}

// Atualiza o texto de preço exibido dentro de cada opção de pagamento.
function atualizarPrecosGateways() {
  const totalBase = totalCarrinho();
  const totalCard = valorCartao(totalBase);

  const hintPix = document.querySelector('#cardOptPix .gateway-text span');
  const hintCard = document.querySelector('#cardOptMp .gateway-text span');

  if (hintPix) {
    hintPix.textContent = totalBase > 0
      ? `Total no Pix: ${formatMoney(totalBase)} — sem acréscimo`
      : 'Pagamento via Mercado Pago';
  }

  if (hintCard) {
    hintCard.textContent = totalBase > 0
      ? `Total no cartão: ${formatMoney(totalCard)} — inclui 5% de tarifa`
      : 'Pagamento via Mercado Pago';
  }
}

function atualizarCarrinho() {
  if (checkoutBrickController) {
    void invalidarCheckoutCartao();
  }

  const list = document.getElementById('cartItemsList');
  list.innerHTML = '';

  let totalItens = 0;

  if (state.qtdAdultos > 0) {
    const subtotal = state.qtdAdultos * PRECO_ADULTO;
    totalItens += state.qtdAdultos;

    const item = document.createElement('div');
    item.className = 'cart-line-item';

    item.innerHTML = `
      <span>
        🎟️ <strong>${state.qtdAdultos}x</strong>
        Imersão Adulto (${formatMoney(PRECO_ADULTO)} cada)
      </span>
      <strong>${formatMoney(subtotal)}</strong>
    `;

    list.appendChild(item);
  }

  if (state.qtdAlmocos > 0) {
    const subtotal = state.qtdAlmocos * PRECO_ALMOCO;
    totalItens += state.qtdAlmocos;

    const item = document.createElement('div');
    item.className = 'cart-line-item';

    item.innerHTML = `
      <span>
        🍽️ <strong>${state.qtdAlmocos}x</strong>
        Almoço no Evento (${formatMoney(PRECO_ALMOCO)} cada)
      </span>
      <strong>${formatMoney(subtotal)}</strong>
    `;

    list.appendChild(item);
  }

  if ((state.qtdDoces || 0) > 0) {
    const subtotal = state.qtdDoces * PRECO_DOCE;
    totalItens += state.qtdDoces;

    const item = document.createElement('div');
    item.className = 'cart-line-item';

    item.innerHTML = `
      <span>
        🍬 <strong>${state.qtdDoces}x</strong>
        Doce de Teste (${formatMoney(PRECO_DOCE)} cada)
      </span>
      <strong>${formatMoney(subtotal)}</strong>
    `;

    list.appendChild(item);
  }

  if (state.criancas.length > 0) {
    totalItens += state.criancas.length;

    const item = document.createElement('div');
    item.className = 'cart-line-item';

    item.innerHTML = `
      <span>
        👶 <strong>${state.criancas.length}x</strong>
        Espaço Kids (0 a 11 anos)
      </span>
      <span class="badge-free" style="font-size: 0.75rem; padding: 2px 6px;">
        GRÁTIS
      </span>
    `;

    list.appendChild(item);
  }

  // Linha do acréscimo, visível quando a forma escolhida é cartão.
  const acrescimo =
    state.gateway === 'mercadopago'
      ? Math.round(
          (valorCartao(totalCarrinho()) - totalCarrinho()) * 100
        ) / 100
      : 0;

  if (acrescimo > 0) {
    const item = document.createElement('div');
    item.className = 'cart-line-item';

    item.innerHTML = `
      <span>💳 Acréscimo do cartão (5%)</span>
      <strong>${formatMoney(acrescimo)}</strong>
    `;

    list.appendChild(item);
  }

  if (totalItens === 0) {
    list.innerHTML = `
      <p style="color: #94a3b8; font-size: 0.9rem; text-align: center; padding: 12px 0;">
        Seu carrinho está vazio. Adicione ao menos um ingresso ou item.
      </p>
    `;
  }

  document.getElementById('itemCountBadge').textContent =
    `${totalItens} ${totalItens === 1 ? 'item' : 'itens'} no carrinho`;

  document.getElementById('cartTotal').textContent =
    formatMoney(totalExibido());

  atualizarPrecosGateways();
  atualizarBotaoCheckout();
}

// ---------------- VALIDAÇÃO ----------------

function validarPedido() {
  const form = document.getElementById('formInscricao');

  if (form && !form.reportValidity()) return false;

  const nome = document.getElementById('nomeResponsavel');
  const telefone = document.getElementById('whatsapp');

  if (nome.value.trim().length < 3) {
    alert('Por favor, informe o nome completo do responsável.');
    nome.focus();
    return false;
  }

  const digitos = telefone.value.replace(/\D/g, '');

  if (digitos.length < 10 || digitos.length > 11) {
    alert('Por favor, informe um WhatsApp válido com DDD.');
    telefone.focus();
    return false;
  }

  if (
    state.qtdAdultos > state.disponibilidade.adultosRestantes ||
    state.qtdAlmocos > state.disponibilidade.almocosRestantes
  ) {
    alert('A quantidade selecionada ultrapassa as vagas disponíveis.');
    return false;
  }

  if (totalCarrinho() <= 0) {
    alert('Selecione ao menos 1 item no carrinho.');
    return false;
  }

  for (let i = 0; i < state.adultosNomes.length; i++) {
    if (state.adultosNomes[i].trim().length < 3) {
      alert(`Preencha o nome completo do ${i + 2}º adulto.`);
      return false;
    }
  }

  for (let i = 0; i < state.criancas.length; i++) {
    const crianca = state.criancas[i];

    if (crianca.nome.trim().length < 2) {
      alert(`Preencha o nome da ${i + 1}ª criança.`);
      return false;
    }

    if (
      !Number.isInteger(crianca.idade) ||
      crianca.idade < 0 ||
      crianca.idade > 11
    ) {
      alert('Informe uma idade de 0 a 11 anos para as crianças.');
      return false;
    }
  }

  const bebes = state.criancas.filter((c) => c.idade <= 2).length;
  const kids = state.criancas.filter((c) => c.idade >= 3).length;

  if (bebes > state.disponibilidade.bebesRestantes) {
    alert(`Restam apenas ${state.disponibilidade.bebesRestantes} vagas para bebês.`);
    return false;
  }

  if (kids > state.disponibilidade.criancasRestantes) {
    alert(
      `Restam apenas ${state.disponibilidade.criancasRestantes} vagas para crianças de 3 a 11 anos.`
    );
    return false;
  }

  return true;
}

// ---------------- PEDIDO PENDENTE (sobrevive a reload) ----------------

function salvarPedidoPendente(ref, pix) {
  try {
    localStorage.setItem(
      CHAVE_PEDIDO,
      JSON.stringify({ ref, pix: pix || null, criadoEm: Date.now() })
    );
  } catch {
    /* armazenamento indisponível: segue sem retomar após reload */
  }
}

function limparPedidoPendente() {
  try {
    localStorage.removeItem(CHAVE_PEDIDO);
  } catch {
    /* ignora */
  }
}

function lerPedidoPendente() {
  try {
    const raw = localStorage.getItem(CHAVE_PEDIDO);
    if (!raw) return null;

    const dados = JSON.parse(raw);

    if (!dados?.ref || Date.now() - dados.criadoEm > VALIDADE_PEDIDO_MS) {
      limparPedidoPendente();
      return null;
    }

    return dados;
  } catch {
    return null;
  }
}

// ---------------- PAINEL DE PAGAMENTO / ACOMPANHAMENTO ----------------

function obterPainel() {
  let painel = document.getElementById('painelPagamento');

  if (!painel) {
    painel = document.createElement('section');
    painel.id = 'painelPagamento';
    painel.className = 'section-card';
    painel.style.cssText = 'text-align:center; padding:30px 20px;';

    const main = document.querySelector('.form-container');

    if (main) {
      main.style.display = 'none';
      main.insertAdjacentElement('afterend', painel);
    } else {
      document.querySelector('.app-container').appendChild(painel);
    }
  }

  return painel;
}

function definirStatusPainel(mensagem) {
  const el = document.getElementById('statusPagamento');
  if (el) el.textContent = mensagem;
}

function copiarTexto(texto, botao) {
  const feedback = () => {
    const original = botao.textContent;
    botao.textContent = '✅ Código copiado!';
    setTimeout(() => {
      botao.textContent = original;
    }, 2000);
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(texto).then(feedback).catch(() => {});
    return;
  }

  const area = document.getElementById('pixCodigo');

  if (area) {
    area.select();
    document.execCommand('copy');
    feedback();
  }
}

function mostrarPainel({ ref, pix, titulo, mensagem }) {
  const painel = obterPainel();

  painel.innerHTML = `
    <h2 id="painelTitulo" style="color:#fff; margin-bottom:8px;"></h2>
    <p id="painelMensagem" style="color:#94a3b8; margin-bottom:16px;"></p>
    <div id="pixQrWrap" style="margin-bottom:16px;"></div>
    <div id="pixCodigoWrap" style="display:none; margin-bottom:16px;">
      <textarea id="pixCodigo" readonly rows="4"
        style="width:100%; padding:10px; border-radius:10px; background:rgba(255,255,255,0.05); color:#e2e8f0; border:1px solid rgba(255,255,255,0.1); font-size:0.8rem; resize:none;"></textarea>
      <button type="button" class="btn-checkout" id="btnCopiarPix" style="margin-top:10px;">
        Copiar código Pix
      </button>
    </div>
    <p id="statusPagamento" style="color:#facc15; font-weight:600; margin:16px 0;">
      ⏳ Aguardando confirmação do pagamento...
    </p>
    <button type="button" id="btnVerificar"
      style="background:none; border:1px solid #818cf8; color:#818cf8; padding:10px 18px; border-radius:10px; cursor:pointer; margin-right:8px;">
      Já paguei — verificar agora
    </button>
    <button type="button" id="btnRefazer"
      style="background:none; border:none; color:#94a3b8; text-decoration:underline; cursor:pointer; padding:10px;">
      Fazer novo pedido
    </button>
    <p style="color:#64748b; font-size:0.8rem; margin-top:12px;">
      Se você já pagou, não faça um novo pedido: a confirmação chega sozinha.
    </p>
  `;

  document.getElementById('painelTitulo').textContent = titulo;
  document.getElementById('painelMensagem').textContent = mensagem;

  if (pix?.qr_code) {
    const wrapCodigo = document.getElementById('pixCodigoWrap');
    const area = document.getElementById('pixCodigo');

    wrapCodigo.style.display = 'block';
    area.value = pix.qr_code;

    if (
      typeof pix.qr_code_base64 === 'string' &&
      /^[A-Za-z0-9+/=]+$/.test(pix.qr_code_base64)
    ) {
      const img = document.createElement('img');
      img.src = `data:image/png;base64,${pix.qr_code_base64}`;
      img.alt = 'QR Code Pix';
      img.width = 220;
      img.height = 220;
      img.style.cssText = 'background:#fff; padding:8px; border-radius:12px;';
      document.getElementById('pixQrWrap').appendChild(img);
    }

    const btnCopiar = document.getElementById('btnCopiarPix');
    btnCopiar.addEventListener('click', () => copiarTexto(pix.qr_code, btnCopiar));
  }

  document.getElementById('btnVerificar').addEventListener('click', () => {
    definirStatusPainel('⏳ Verificando pagamento...');
    iniciarAcompanhamento(ref);
  });

  document.getElementById('btnRefazer').addEventListener('click', () => {
    pararAcompanhamento();
    limparPedidoPendente();
    window.location.reload();
  });

  painel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function mostrarSucesso() {
  pararAcompanhamento();
  limparPedidoPendente();

  const container = document.querySelector('.app-container');

  container.innerHTML = `
    <div style="text-align:center; padding:60px 20px; color:#fff;">
      <div style="font-size:3rem;">✅</div>
      <h1 style="margin:16px 0 8px;">Inscrição confirmada!</h1>
      <p style="color:#94a3b8;">
        Pagamento aprovado. Entraremos em contato pelo WhatsApp informado.
      </p>
    </div>
  `;
}

function mostrarFalha(status) {
  pararAcompanhamento();
  limparPedidoPendente();

  definirStatusPainel(
    status === 'cancelled'
      ? '❌ O pagamento expirou ou foi cancelado. Faça um novo pedido.'
      : '❌ O pagamento não foi aprovado. Faça um novo pedido.'
  );
}

// ---------------- ACOMPANHAMENTO DO PAGAMENTO ----------------

function pararAcompanhamento() {
  pollAtivo = false;
  clearTimeout(pollTimer);
  pollTimer = null;
}

async function consultarStatus(ref) {
  const res = await fetch(`/api/status?ref=${encodeURIComponent(ref)}`, {
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`Status HTTP ${res.status}`);

  return res.json();
}

function iniciarAcompanhamento(ref) {
  pararAcompanhamento();

  refAcompanhada = ref;
  pollAtivo = true;

  const inicio = Date.now();

  const tick = async () => {
    if (!pollAtivo) return;

    try {
      const dados = await consultarStatus(ref);

      if (!pollAtivo) return;

      if (dados.status === 'approved') {
        mostrarSucesso();
        return;
      }

      if (['rejected', 'cancelled'].includes(dados.status)) {
        mostrarFalha(dados.status);
        return;
      }
    } catch (erro) {
      console.warn('Falha ao consultar o status:', erro.message);
    }

    const decorrido = Date.now() - inicio;

    if (decorrido > LIMITE_ACOMPANHAMENTO_MS) {
      pararAcompanhamento();
      definirStatusPainel(
        'Ainda não recebemos a confirmação. Se você já pagou, toque em "verificar agora" em alguns minutos.'
      );
      return;
    }

    pollTimer = setTimeout(tick, decorrido > 5 * 60 * 1000 ? 10000 : 4000);
  };

  tick();
}

function retomarPedidoPendente() {
  const pedido = lerPedidoPendente();
  if (!pedido) return;

  refPedidoAtual = pedido.ref;

  mostrarPainel({
    ref: pedido.ref,
    pix: pedido.pix,
    titulo: pedido.pix ? '⚡ Pague com Pix' : 'Verificando seu pagamento',
    mensagem: pedido.pix
      ? 'Escaneie o QR Code ou use o Pix Copia e Cola. A confirmação aparece aqui automaticamente.'
      : 'Estamos confirmando seu pagamento com o Mercado Pago.',
  });

  iniciarAcompanhamento(pedido.ref);
}

// ---------------- ENVIO DO PEDIDO ----------------

async function gerarPix(ref) {
  const res = await fetch('/api/process_payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payment_method_id: 'pix' }),
  });

  const response = await res.json();

  if (!res.ok) {
    throw new Error(response.error || 'Não foi possível gerar o Pix.');
  }

  if (response.status === 'approved') {
    mostrarSucesso();
    return;
  }

  if (!response.pix?.qr_code) {
    throw new Error(
      'O Mercado Pago não retornou o código Pix. Tente novamente.'
    );
  }

  salvarPedidoPendente(ref, response.pix);

  mostrarPainel({
    ref,
    pix: response.pix,
    titulo: '⚡ Pague com Pix',
    mensagem:
      'Escaneie o QR Code ou use o Pix Copia e Cola. A confirmação aparece aqui automaticamente.',
  });

  iniciarAcompanhamento(ref);
}

async function finalizarPedido() {
  if (bloqueado()) return;
  if (!validarPedido()) return;

  const gatewayPedido = state.gateway;
  const modal = document.getElementById('modalCheckout');

  enviandoPedido = true;
  bloquearSelecaoPagamento(true);
  atualizarBotaoCheckout();

  if (modal) modal.style.display = 'flex';

  try {
    const payload = {
      responsavel: document.getElementById('nomeResponsavel').value.trim(),
      email: document.getElementById('email').value.trim(),
      whatsapp: document.getElementById('whatsapp').value.trim(),

      qtdAdultos: state.qtdAdultos,
      adultosNomes: state.adultosNomes.map((nome) => nome.trim()),
      qtdAlmocos: state.qtdAlmocos,
      qtdDoces: state.qtdDoces || 0,

      criancas: state.criancas.map((crianca) => ({
        ...crianca,
        nome: crianca.nome.trim(),
      })),

      gateway: 'mercadopago',
      metodoPagamento: gatewayPedido,
    };

    const res = await fetch('/api/inscricao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Erro ao processar a inscrição.');
    }

    if (!data.customId) {
      throw new Error('O servidor não retornou a referência do pedido.');
    }

    refPedidoAtual = data.customId;

    if (gatewayPedido === 'pix') {
      await gerarPix(data.customId);
      if (modal) modal.style.display = 'none';
    } else {
      if (modal) modal.style.display = 'none';

      if (!data.chargeId) {
        throw new Error(
          'O servidor não retornou a preferência para o pagamento com cartão.'
        );
      }

      // data.total já vem do servidor com o acréscimo do cartão.
      await renderizarCheckoutBricks(data.chargeId, data.total);
    }
  } catch (err) {
    console.error('Erro na inscrição:', err);
    alert(`Atenção: ${err.message}`);
  } finally {
    if (modal) modal.style.display = 'none';

    enviandoPedido = false;
    bloquearSelecaoPagamento(carregandoCheckout);
    atualizarBotaoCheckout();
  }
}

// ---------------- CHECKOUT MERCADO PAGO (CARTÃO) ----------------

function converterTotal(valor) {
  if (typeof valor === 'number') return valor;

  const texto = String(valor ?? '')
    .replace(/R\$\s*/g, '')
    .replace(/\s/g, '');

  return Number(
    texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto
  );
}

async function renderizarCheckoutBricks(preferenceId, total) {
  carregandoCheckout = true;
  bloquearSelecaoPagamento(true);
  atualizarBotaoCheckout();

  const container = document.getElementById('paymentBrick_container');

  try {
    if (!container) {
      throw new Error('O container do checkout não foi encontrado.');
    }

    const configRes = await fetch('/api/config/mp');

    if (!configRes.ok) {
      throw new Error('Não foi possível carregar a configuração do Mercado Pago.');
    }

    const config = await configRes.json();

    if (!config.publicKey) {
      throw new Error('A chave pública do Mercado Pago não está configurada.');
    }

    if (typeof MercadoPago === 'undefined') {
      throw new Error('O SDK do Mercado Pago não foi carregado.');
    }

    const amount = converterTotal(total);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('O valor retornado pelo servidor é inválido.');
    }

    if (checkoutBrickController) {
      await checkoutBrickController.unmount();
      checkoutBrickController = null;
    }

    container.innerHTML = '';
    container.style.display = 'block';

    const mp = new MercadoPago(config.publicKey, { locale: 'pt-BR' });
    const bricksBuilder = mp.bricks();

    checkoutBrickController = await bricksBuilder.create(
      'payment',
      'paymentBrick_container',
      {
        initialization: {
          amount,
          preferenceId,
        },

        customization: {
          paymentMethods: {
            creditCard: 'all',
          },
        },

        callbacks: {
          onReady: () => {
            console.log('Checkout de cartão carregado.');
          },

          onSubmit: async ({ formData }) => {
            if (enviandoPedido) {
              throw new Error('Já existe um pagamento em processamento.');
            }

            enviandoPedido = true;
            bloquearSelecaoPagamento(true);

            try {
              const res = await fetch('/api/process_payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
              });

              const response = await res.json();

              if (!res.ok) {
                throw new Error(
                  response.error || 'Não foi possível processar o pagamento.'
                );
              }

              const ref = response.customId || refPedidoAtual;

              if (response.status === 'approved') {
                setTimeout(mostrarSucesso, 300);
              } else if (response.status === 'rejected') {
                throw new Error(
                  'Pagamento recusado. Confira os dados ou tente outro cartão.'
                );
              } else {
                // pending, in_process ou outro: acompanha até decidir.
                salvarPedidoPendente(ref, null);

                setTimeout(() => {
                  mostrarPainel({
                    ref,
                    pix: null,
                    titulo: 'Pagamento em análise',
                    mensagem:
                      'Estamos aguardando a confirmação do seu cartão. Esta tela atualiza sozinha.',
                  });

                  iniciarAcompanhamento(ref);
                }, 300);
              }
            } catch (error) {
              console.error('Erro no pagamento:', error);
              alert(error.message || 'Erro ao processar o pagamento.');
              throw error;
            } finally {
              enviandoPedido = false;
              bloquearSelecaoPagamento(false);
              atualizarBotaoCheckout();
            }
          },

          onError: (error) => {
            console.error('Erro no Checkout Bricks:', error);
          },
        },
      }
    );
  } catch (error) {
    checkoutBrickController = null;
    console.error('Erro ao carregar o checkout:', error);
    throw error;
  } finally {
    carregandoCheckout = false;
    bloquearSelecaoPagamento(enviandoPedido);
    atualizarBotaoCheckout();
  }
}

// ---------------- INICIALIZAÇÃO ----------------

document.addEventListener('DOMContentLoaded', () => {
  const telInput = document.getElementById('whatsapp');

  if (telInput) {
    telInput.addEventListener('input', (e) => {
      const v = e.target.value.replace(/\D/g, '').slice(0, 11);

      if (v.length > 10) {
        e.target.value = `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
      } else if (v.length > 6) {
        e.target.value = `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`;
      } else if (v.length > 2) {
        e.target.value = `(${v.slice(0, 2)}) ${v.slice(2)}`;
      } else if (v.length > 0) {
        e.target.value = `(${v}`;
      } else {
        e.target.value = '';
      }
    });
  }

  // Ao voltar para a aba (ex.: depois de pagar no app do banco), confere na hora.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && refAcompanhada && pollAtivo) {
      iniciarAcompanhamento(refAcompanhada);
    }
  });

  document.getElementById('cardAdulto')?.classList.toggle(
    'selected',
    state.qtdAdultos > 0
  );

  renderizarInputsAdultosExtras();
  atualizarCarrinho();
  trcarVisualGateway();
  carregarDisponibilidade();
  retomarPedidoPendente();
});