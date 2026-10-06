const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'inscricoes.json');
const CSV_FILE = path.join(__dirname, '..', 'data', 'inscricoes.csv');

const LIMITES = {
  adultos: 120,
  almocos: 50,
  criancas: 20,
  bebes: 6,
};

const STATUS_AGUARDANDO = 'Aguardando pagamento';
const STATUS_CONFIRMADO = 'Confirmado (pago)';

const CSV_HEADER = [
  'Data/Hora',
  'Responsável',
  'WhatsApp',
  'E-mail',
  'Qtd Adultos',
  'Adultos Adicionais',
  'Qtd Crianças',
  'Crianças (Nomes e Idades)',
  'Qtd Almoços',
  'Qtd Doces',
  'Valor Total',
  'Forma de Pagamento',
  'Status',
  'Charge ID',
  'Custom ID',
  'Payment ID',
  'Observação',
].join(';') + '\n';

// Escapa aspas e quebras de linha para o CSV não quebrar.
function csv(valor) {
  const texto = String(valor ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ');
  return `"${texto}"`;
}

function agora() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  });
}

class Storage {
  constructor() {
    this.ensureFiles();
  }

  ensureFiles() {
    const dir = path.dirname(DATA_FILE);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(CSV_FILE)) {
      fs.writeFileSync(CSV_FILE, CSV_HEADER, 'utf8');
    }
  }

  getAll() {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (erro) {
      if (erro.code !== 'ENOENT') {
        // Arquivo corrompido: guarda uma cópia antes que um novo save o sobrescreva.
        console.error('[Storage] Erro ao ler inscricoes.json:', erro.message);

        try {
          fs.copyFileSync(DATA_FILE, `${DATA_FILE}.corrompido-${Date.now()}`);
        } catch {
          /* sem cópia disponível */
        }
      }

      return [];
    }
  }

  saveAll(list) {
    // Escreve em arquivo temporário e renomeia, para não deixar JSON pela metade.
    const tmp = `${DATA_FILE}.tmp`;

    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);

    this.regenerateCsv(list);
  }

  regenerateCsv(list) {
    const linhas = list.map((item) => {
      const criancas = Array.isArray(item.criancas) ? item.criancas : [];

      const criancasStr = criancas
        .map((c) => `${c.nome || 'Criança'} (${c.idade}a)`)
        .join(', ');

      const adultosExtras = Array.isArray(item.adultosNomes)
        ? item.adultosNomes.join(', ')
        : '';

      const valor = `R$ ${Number(item.valorTotal || 0)
        .toFixed(2)
        .replace('.', ',')}`;

      return [
        csv(item.dataHora),
        csv(item.responsavel),
        csv(item.whatsapp),
        csv(item.email),
        Number(item.qtdAdultos) || 0,
        csv(adultosExtras),
        Number(item.qtdCriancas ?? criancas.length) || 0,
        csv(criancasStr),
        Number(item.qtdAlmocos) || 0,
        Number(item.qtdDoces) || 0,
        csv(valor),
        csv(item.formaPagamento || 'Mercado Pago'),
        csv(item.status || STATUS_AGUARDANDO),
        csv(item.chargeId),
        csv(item.customId),
        csv(item.paymentId),
        csv(item.observacao),
      ].join(';');
    });

    fs.writeFileSync(
      CSV_FILE,
      CSV_HEADER + linhas.join('\n') + (linhas.length ? '\n' : ''),
      'utf8'
    );
  }

  getConfirmados() {
    const list = this.getAll();

    let adultos = 0;
    let almocos = 0;
    let criancas = 0;
    let bebes = 0;

    for (const item of list) {
      if (item.status !== STATUS_CONFIRMADO) continue;

      adultos += Number(item.qtdAdultos) || 0;
      almocos += Number(item.qtdAlmocos) || 0;

      for (const c of item.criancas || []) {
        const idade = Number(c.idade);

        if (!Number.isNaN(idade)) {
          if (idade <= 2) bebes++;
          else criancas++;
        }
      }
    }

    return { adultos, almocos, criancas, bebes };
  }

  getDisponibilidade() {
    const c = this.getConfirmados();

    return {
      adultosRestantes: Math.max(0, LIMITES.adultos - c.adultos),
      almocosRestantes: Math.max(0, LIMITES.almocos - c.almocos),
      criancasRestantes: Math.max(0, LIMITES.criancas - c.criancas),
      bebesRestantes: Math.max(0, LIMITES.bebes - c.bebes),
      totaisConfirmados: c,
      limitesTotais: LIMITES,
    };
  }

  addInscricao(dados) {
    const list = this.getAll();
    const criancas = Array.isArray(dados.criancas) ? dados.criancas : [];

    const novo = {
      id: `ins_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      dataHora: agora(),
      status: STATUS_AGUARDANDO,
      qtdCriancas: criancas.length,
      ...dados,
    };

    list.push(novo);
    this.saveAll(list);

    return novo;
  }

  marcarComoPago(chargeId) {
    const list = this.getAll();
    let found = false;

    for (const item of list) {
      if (String(item.chargeId) === String(chargeId)) {
        if (item.status !== STATUS_CONFIRMADO) {
          item.status = STATUS_CONFIRMADO;
          item.pagoEm = agora();
        }

        found = true;
      }
    }

    if (found) this.saveAll(list);

    return found;
  }

  getPorChargeId(chargeId) {
    return this.getAll().find(
      (item) => String(item.chargeId) === String(chargeId)
    );
  }

  getPorCustomId(customId) {
    return this.getAll().find(
      (item) => String(item.customId) === String(customId)
    );
  }
}

module.exports = new Storage();