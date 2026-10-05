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
      const header = [
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
        'Charge ID Efí',
      ].join(';') + '\n';
      fs.writeFileSync(CSV_FILE, header, 'utf8');
    }
  }

  getAll() {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  saveAll(list) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), 'utf8');
    this.regenerateCsv(list);
  }

  regenerateCsv(list) {
    const header = [
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
      'Charge ID Efí',
    ].join(';') + '\n';

    const lines = list.map((item) => {
      const listaCriancas = Array.isArray(item.criancas) ? item.criancas : [];
      const criancasStr = listaCriancas.map(c => `${c.nome ? c.nome : 'Criança'} (${c.idade}a)`).join(', ');
      const adultosExtras = Array.isArray(item.adultosNomes) ? item.adultosNomes.join(', ') : '';

      return [
        `"${item.dataHora ? item.dataHora : ''}"`,
        `"${item.responsavel ? item.responsavel : ''}"`,
        `"${item.whatsapp ? item.whatsapp : ''}"`,
        `"${item.email ? item.email : ''}"`,
        item.qtdAdultos ? item.qtdAdultos : 0,
        `"${adultosExtras}"`,
        item.qtdCriancas ? item.qtdCriancas : 0,
        `"${criancasStr}"`,
        item.qtdAlmocos ? item.qtdAlmocos : 0,
        item.qtdDoces ? item.qtdDoces : 0,
        `"R$ ${((item.valorTotal ? item.valorTotal : 0)).toFixed(2).replace('.', ',')}"`,
        `"${item.formaPagamento ? item.formaPagamento : 'Mercado Pago'}"`,
        `"${item.status ? item.status : STATUS_AGUARDANDO}"`,
        `"${item.chargeId ? item.chargeId : ''}"`,
      ].join(';');
    });

    fs.writeFileSync(CSV_FILE, header + lines.join('\n'), 'utf8');
  }

  getConfirmados() {
    const list = this.getAll();
    let adultos = 0;
    let almocos = 0;
    let criancas = 0;
    let bebes = 0;

    for (const item of list) {
      if (item.status === STATUS_CONFIRMADO) {
        adultos += Number(item.qtdAdultos) || 0;
        almocos += Number(item.qtdAlmocos) || 0;

        for (const c of item.criancas || []) {
          const idade = Number(c.idade);
          if (!isNaN(idade)) {
            if (idade <= 2) bebes++;
            else criancas++;
          }
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
    const novo = {
      id: `ins_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      dataHora: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      status: STATUS_AGUARDANDO,
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
        item.status = STATUS_CONFIRMADO;
        item.pagoEm = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        found = true;
      }
    }

    if (found) {
      this.saveAll(list);
    }
    return found;
  }

  getPorChargeId(chargeId) {
    const list = this.getAll();
    return list.find((item) => String(item.chargeId) === String(chargeId));
  }
}

module.exports = new Storage();