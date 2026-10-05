/**
 * Frontend — Carrinho e inscrição da Imersão de Cura
 * Pagamentos integrados via Mercado Pago (Pix e Cartão de Crédito)
 */

const PRECO_ADULTO = 40;
const PRECO_ALMOCO = 25;

let checkoutBrickController = null;
let enviandoPedido = false;
let carregandoCheckout = false;

const state = {
  qtdAdultos: 1,
  adultosNomes: [],
  qtdAlmocos: 0,
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

function totalCarrinho() {
  return (
    state.qtdAdultos * PRECO_ADULTO +
    state.qtdAlmocos * PRECO_ALMOCO
  );
}

function gatewayDisponivel(gateway) {
  return Boolean(
    state.disponibilidade.gatewaysDisponiveis?.[gateway] ?? true
  );
}

function atualizarBotaoCheckout() {
  const btn = document.getElementById('btnSubmit');
  const texto = document.getElementById('btnSubmitText');
  const spinner = document.getElementById('btnSpinner');

  if (!btn) return;

  const ocupado = enviandoPedido || carregandoCheckout;
  const temPagamento = totalCarrinho() > 0;
  const brickAtivo =
    state.gateway === 'mercadopago' &&
    Boolean(checkoutBrickController);

  btn.disabled =
    ocupado ||
    !temPagamento ||
    !gatewayDisponivel(state.gateway);

  btn.style.display = brickAtivo ? 'none' : '';

  if (spinner) {
    spinner.style.display = ocupado ? 'inline-block' : 'none';
  }

  if (texto) {
    texto.textContent = ocupado
      ? 'Processando...'
      : state.gateway === 'pix'
        ? 'Finalizar Inscrição e Pagar com Pix'
        : state.gateway === 'mercadopago'
          ? 'Continuar para Pagamento com Cartão'
          : 'Pagamento Indisponível';
  }
}

function bloquearSelecaoPagamento(bloquear) {
  document
    .querySelectorAll('input[name="paymentGateway"]')
    .forEach((input) => {
      input.disabled =
        bloquear || !gatewayDisponivel(input.value);
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
  configurarGateways(
    state.disponibilidade.gatewaysDisponiveis
  );
}

function configurarGateways(gw) {
  const container = document.getElementById('gatewayContainer');

  if (container) {
    container.style.display = 'block';
  }

  const cardPix = document.getElementById('cardOptPix');
  const cardMp = document.getElementById('cardOptMp');

  if (cardPix) {
    cardPix.style.opacity = '1';
    cardPix.title = 'Pagamento via Pix';
  }

  if (cardMp) {
    cardMp.style.opacity = '1';
    cardMp.title = 'Cartão de crédito via Mercado Pago';
  }

  bloquearSelecaoPagamento(
    enviandoPedido || carregandoCheckout
  );

  trcarVisualGateway();
}

function trocarGateway(gw) {
  if (enviandoPedido || carregandoCheckout) {
    trcarVisualGateway();
    return;
  }

  if (!['pix', 'mercadopago'].includes(gw)) return;

  state.gateway = gw;
  trcarVisualGateway();
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
      ? 'Pagamento via Pix pelo Mercado Pago.'
      : state.gateway === 'mercadopago'
        ? 'Pagamento com cartão de crédito pelo Mercado Pago.'
        : 'Selecione uma forma de pagamento.';
  }

  const container = document.getElementById(
    'paymentBrick_container'
  );

  if (container) {
    container.style.display =
      state.gateway === 'mercadopago' ? 'block' : 'none';
  }

  atualizarBotaoCheckout();
}

function atualizarBadges() {
  const d = state.disponibilidade;

  const bAdultos = document.getElementById('badgeAdultos');
  const bAlmocos = document.getElementById('badgeAlmocos');
  const bKids = document.getElementById('badgeKids');

  if (bAdultos) {
    bAdultos.textContent = `${d.adultosRestantes} restantes`;
  }

  if (bAlmocos) {
    bAlmocos.textContent = `${d.almocosRestantes} restantes`;
  }

  if (bKids) {
    bKids.textContent =
      `${Number(d.criancasRestantes) + Number(d.bebesRestantes)} vagas`;
  }

  const sAdultos = document.getElementById('stockAdultos');

  if (sAdultos) {
    sAdultos.textContent =
      `${d.adultosRestantes} de 120 vagas disponíveis`;
  }

  const sAlmocos = document.getElementById('stockAlmocos');

  if (sAlmocos) {
    sAlmocos.textContent = Number(d.almocosRestantes) === 0
      ? '❌ Almoços ESGOTADOS'
      : `${d.almocosRestantes} de 50 almoços disponíveis`;
  }

  const pBebes = document.getElementById('pillBebes');

  if (pBebes) {
    pBebes.textContent =
      `Bebês (0-2a): ${d.bebesRestantes} vagas`;
  }

  const pCriancas = document.getElementById('pillCriancas');

  if (pCriancas) {
    pCriancas.textContent =
      `Kids (3-11a): ${d.criancasRestantes} vagas`;
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
  if (enviandoPedido || carregandoCheckout) return;

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
  if (enviandoPedido || carregandoCheckout) return;

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

// ---------------- ESPAÇO KIDS ----------------

function adicionarCrianca() {
  if (enviandoPedido || carregandoCheckout) return;

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
    idade: Number(state.disponibilidade.criancasRestantes) > 0
      ? 5
      : 0,
  });

  renderizarCriancas();
  atualizarCarrinho();
}

function removerCrianca(index) {
  if (enviandoPedido || carregandoCheckout) return;

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

      option.textContent =
        `${idadeTexto} ${age <= 2 ? '(Bebê)' : '(Kids)'}`;

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

    button.addEventListener('click', () => {
      removerCrianca(index);
    });

    row.append(input, select, button);
    container.appendChild(row);
  });
}

// ---------------- ATUALIZAÇÃO DO CARRINHO ----------------

async function invalidarCheckoutCartao() {
  const controller = checkoutBrickController;
  checkoutBrickController = null;

  atualizarBotaoCheckout();

  if (controller) {
    try {
      await controller.unmount();
    } catch (error) {
      console.warn('Erro ao desmontar o checkout:', error);
    }
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

  if (state.criancas.length > 0) {
    totalItens += state.criancas.length;

    const item = document.createElement('div');
    item.className = 'cart-line-item';

    item.innerHTML = `
      <span>
        👶 <strong>${state.criancas.length}x</strong>
        Espaço Kids (0 a 11 anos)
      </span>
      <span
        class="badge-free"
        style="font-size: 0.75rem; padding: 2px 6px;"
      >
        GRÁTIS
      </span>
    `;

    list.appendChild(item);
  }

  if (totalItens === 0) {
    list.innerHTML = `
      <p style="color: #94a3b8; font-size: 0.9rem; text-align: center; padding: 12px 0;">
        Seu carrinho está vazio. Adicione ao menos um ingresso ou almoço.
      </p>
    `;
  }

  document.getElementById('itemCountBadge').textContent =
    `${totalItens} ${totalItens === 1 ? 'item' : 'itens'} no carrinho`;

  document.getElementById('cartTotal').textContent =
    formatMoney(totalCarrinho());

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
    alert('Selecione ao menos 1 ingresso ou 1 almoço no carrinho.');
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
    alert(
      `Restam apenas ${state.disponibilidade.bebesRestantes} vagas para bebês.`
    );
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

// ---------------- ENVIO DO PEDIDO ----------------

async function finalizarPedido() {
  if (enviandoPedido || carregandoCheckout) return;
  if (!validarPedido()) return;

  const gatewayPedido = state.gateway;
  const modal = document.getElementById('modalCheckout');

  enviandoPedido = true;
  bloquearSelecaoPagamento(true);
  atualizarBotaoCheckout();

  if (modal) modal.style.display = 'flex';

  try {
    const payload = {
      responsavel: document
        .getElementById('nomeResponsavel')
        .value.trim(),

      email: document.getElementById('email').value.trim(),
      whatsapp: document.getElementById('whatsapp').value.trim(),

      qtdAdultos: state.qtdAdultos,
      adultosNomes: state.adultosNomes.map((nome) => nome.trim()),
      qtdAlmocos: state.qtdAlmocos,

      criancas: state.criancas.map((crianca) => ({
        ...crianca,
        nome: crianca.nome.trim(),
      })),

      gateway: 'mercadopago',
      metodoPagamento: gatewayPedido, // Garante que envia 'pix' ou 'cartao' corretamente para o servidor
    };

    const res = await fetch('/api/inscricao', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(
        data.error || 'Erro ao processar a inscrição.'
      );
    }

    if (modal) modal.style.display = 'none';

    if (gatewayPedido === 'mercadopago') {
      if (!data.chargeId) {
        throw new Error(
          'O servidor não retornou a preferência para o pagamento com cartão.'
        );
      }

      await renderizarCheckoutBricks(
        data.chargeId,
        data.total
      );
    } else if (data.paymentUrl) {
      // O servidor já gravou localmente e sincronizou com o Google Sheets antes de devolver o paymentUrl
      window.location.href = data.paymentUrl;
    } else {
      throw new Error(
        'O servidor não retornou o link de pagamento.'
      );
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

// ---------------- CHECKOUT MERCADO PAGO ----------------

function converterTotal(valor) {
  if (typeof valor === 'number') return valor;

  const texto = String(valor ?? '')
    .replace(/R\$\s*/g, '')
    .replace(/\s/g, '');

  return Number(
    texto.includes(',')
      ? texto.replace(/\./g, '').replace(',', '.')
      : texto
  );
}

async function renderizarCheckoutBricks(preferenceId, total) {
  carregandoCheckout = true;
  bloquearSelecaoPagamento(true);
  atualizarBotaoCheckout();

  const container = document.getElementById(
    'paymentBrick_container'
  );

  try {
    if (!container) {
      throw new Error('O container do checkout não foi encontrado.');
    }

    const configRes = await fetch('/api/config/mp');

    if (!configRes.ok) {
      throw new Error(
        'Não foi possível carregar a configuração do Mercado Pago.'
      );
    }

    const config = await configRes.json();

    if (!config.publicKey) {
      throw new Error(
        'A chave pública do Mercado Pago não está configurada.'
      );
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

    const mp = new MercadoPago(config.publicKey, {
      locale: 'pt-BR',
    });

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
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData),
              });

              const response = await res.json();

              if (!res.ok) {
                throw new Error(
                  response.error ||
                  'Não foi possível processar o pagamento.'
                );
              }

              if (response.status === 'approved') {
                alert(
                  'Pagamento aprovado. Aguarde a confirmação da inscrição pela organização.'
                );
              } else if (response.status === 'pending') {
                alert('Pagamento pendente. Aguarde a confirmação.');
              } else if (response.status === 'in_process') {
                alert('Pagamento em análise. Aguarde a confirmação.');
              } else if (response.status === 'rejected') {
                throw new Error(
                  'Pagamento recusado. Confira os dados ou tente outro cartão.'
                );
              } else {
                alert(
                  'Solicitação enviada. Verifique o status e a confirmação do pagamento.'
                );
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
      let v = e.target.value.replace(/\D/g, '').slice(0, 11);

      if (v.length > 10) {
        e.target.value =
          `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
      } else if (v.length > 6) {
        e.target.value =
          `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`;
      } else if (v.length > 2) {
        e.target.value = `(${v.slice(0, 2)}) ${v.slice(2)}`;
      } else if (v.length > 0) {
        e.target.value = `(${v}`;
      } else {
        e.target.value = '';
      }
    });
  }

  document.getElementById('cardAdulto')?.classList.toggle(
    'selected',
    state.qtdAdultos > 0
  );

  renderizarInputsAdultosExtras();
  atualizarCarrinho();
  trcarVisualGateway();
  carregarDisponibilidade();
});