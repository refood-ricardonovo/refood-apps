/**
 * Quantas famílias tem um turno de entregas? — distribuição sobre a base toda.
 *
 * ```bash
 * node --experimental-strip-types scripts/turnos-por-tamanho.ts
 * node --experimental-strip-types scripts/turnos-por-tamanho.ts --area=recolhas
 * ```
 *
 * Existe para responder a uma pergunta de desenho: **os degraus de densidade do painel estão a ser
 * ditados por turnos que quase não acontecem?** O degrau mais denso manda em todo o resto — é ele
 * que fixa quantas colunas a grelha tem e, por arrasto, o tamanho de tudo — e não fazia sentido
 * decidi-lo sem saber quantos turnos o usam.
 *
 * **A unidade é a que o painel desenha**, e não o que a palavra "turno" sugere: um cartão por
 * `res.delivery.route`, e um ecrã por (núcleo, dia da semana, turno). O mesmo `resource.calendar`
 * em dois dias da semana são dois ecrãs diferentes, com contagens diferentes, e é a contagem de cada
 * ecrã que interessa.
 *
 * **O domínio é copiado do `entregas.ts` de propósito** — incluindo o `beneficiary_id.active`, que
 * tira 16,7% das rotas. Sem ele, a distribuição seria de rotas na base e não de cartões no ecrã, que
 * são coisas diferentes e é a segunda que decide o desenho.
 *
 * Autentica com o utilizador de integração, que lê a base toda. Ver `ligacao.ts`.
 */

import type { OdooDomain } from '@refood/odoo';

import { carregarEnv, createOdooClient, empresasLegiveis, many2oneId } from './ligacao.ts';

const LINGUA = 'pt_PT';

/** Tecto por segurança. A base tem ~3 250 rotas de entrega; se isto alguma vez encher, diz-se. */
const LIMITE = 50_000;

const AREAS = {
	entregas: {
		modelo: 'res.delivery.route',
		ficha: 'beneficiary_id',
		nome: 'famílias',
	},
	recolhas: {
		modelo: 'res.collection.route',
		ficha: 'source_food_id',
		nome: 'fontes',
	},
} as const;

type Area = keyof typeof AREAS;

interface Rota {
	readonly [campo: string]: unknown;
	readonly id: number;
	readonly company_id: [number, string] | false;
	readonly resource_calendar_id: [number, string] | false;
	readonly week_day: string | false;
}

const DIAS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

/** Os degraus do painel, para dizer quantos ecrãs caem em cada um. Ver `densidade()` no `painel.html`. */
const CORTES: Record<Area, readonly number[]> = {
	entregas: [15, 42, 63],
	recolhas: [12, 30, 42],
};

function analisarArea(argumentos: readonly string[]): Area {
	const pedida = argumentos.find((a) => a.startsWith('--area='))?.slice('--area='.length) ?? 'entregas';
	if (pedida !== 'entregas' && pedida !== 'recolhas') throw new Error(`--area só aceita 'entregas' ou 'recolhas'; veio '${pedida}'.`);
	return pedida;
}

/** Um histograma em texto, para a forma da distribuição se ver sem sair do terminal. */
function barra(quantos: number, maximo: number, largura = 42): string {
	return '█'.repeat(Math.max(quantos > 0 ? 1 : 0, Math.round((quantos / maximo) * largura)));
}

function percentil(ordenados: readonly number[], p: number): number {
	if (ordenados.length === 0) return 0;
	const i = Math.min(ordenados.length - 1, Math.floor((p / 100) * ordenados.length));
	return ordenados[i] as number;
}

async function main(): Promise<number> {
	const area = analisarArea(process.argv.slice(2));
	const { modelo, ficha, nome } = AREAS[area];

	const env = carregarEnv();
	const cliente = createOdooClient(env);
	const empresas = await empresasLegiveis(cliente, LINGUA);

	console.log(`Base: ${env.ODOO_DB} em ${env.ODOO_URL}`);
	console.log(`Modelo: ${modelo} — ${empresas.length} empresas legíveis\n`);

	/*
	 * **Sem `read_group`, e é decisão e não preguiça.** O agrupamento teria de ser por três campos
	 * — empresa, turno e dia —, e o que se quer a seguir é a distribuição das contagens, que é uma
	 * segunda passagem sobre o resultado de qualquer maneira. São ~3 250 linhas de três campos: lê-se
	 * tudo e conta-se aqui, sem um `lazy: false` para acertar nem um formato de resposta para
	 * decifrar.
	 */
	const dominio: OdooDomain = [[`${ficha}.active`, '=', true]];

	const rotas = await cliente.searchRead<Rota>(modelo, dominio, {
		fields: ['company_id', 'resource_calendar_id', 'week_day'],
		limit: LIMITE,
		lang: LINGUA,
		context: { allowed_company_ids: empresas },
	});

	if (rotas.length === 0) {
		console.log('Zero rotas. Isto não prova uma tabela vazia — confirma o contexto e as empresas antes de concluir o que quer que seja.');
		return 1;
	}
	if (rotas.length === LIMITE) {
		console.log(`Vieram exactamente ${LIMITE} rotas, que é o limite: há mais e a distribuição está truncada. Sobe o LIMITE.`);
		return 1;
	}

	/* Um ecrã é (núcleo, turno, dia da semana): é assim que o painel os mostra, um de cada vez. */
	const porEcra = new Map<string, number>();
	let semTurno = 0;

	for (const rota of rotas) {
		const turno = many2oneId(rota.resource_calendar_id);
		const empresa = many2oneId(rota.company_id);
		if (turno === null || empresa === null || rota.week_day === false) {
			semTurno++;
			continue;
		}
		const chave = `${empresa}|${turno}|${rota.week_day}`;
		porEcra.set(chave, (porEcra.get(chave) ?? 0) + 1);
	}

	const contagens = [...porEcra.values()].sort((a, b) => a - b);
	const total = contagens.length;
	const soma = contagens.reduce((a, b) => a + b, 0);

	console.log(`${rotas.length} rotas com ficha activa, em ${total} ecrãs (núcleo × turno × dia da semana).`);
	if (semTurno > 0) console.log(`${semTurno} rotas sem turno, empresa ou dia — fora da conta.`);
	console.log('');

	// ------------------------------------------------------------------ histograma
	const BALDES = [
		[1, 15],
		[16, 30],
		[31, 42],
		[43, 55],
		[56, 63],
		[64, 72],
		[73, 90],
		[91, Infinity],
	] as const;

	const alturas = BALDES.map(([de, ate]) => contagens.filter((c) => c >= de && c <= ate).length);
	const maisAlto = Math.max(...alturas);

	console.log(`Distribuição de ${nome} por ecrã`);
	console.log('─'.repeat(78));
	for (const [i, [de, ate]] of BALDES.entries()) {
		const quantos = alturas[i] as number;
		const rotulo = ate === Infinity ? `${de}+` : `${de}–${ate}`;
		const parte = ((quantos / total) * 100).toFixed(1);
		console.log(`${rotulo.padStart(7)}  ${String(quantos).padStart(5)}  ${parte.padStart(5)}%  ${barra(quantos, maisAlto)}`);
	}

	// ------------------------------------------------------------------ acumulados
	console.log('\nQuantos ecrãs passam de…');
	console.log('─'.repeat(78));
	for (const corte of [15, 30, 42, 50, 63, 72, 80, 90]) {
		const acima = contagens.filter((c) => c > corte).length;
		console.log(`  > ${String(corte).padStart(3)}  ${String(acima).padStart(5)} ecrãs  ${((acima / total) * 100).toFixed(2).padStart(6)}%`);
	}

	// ------------------------------------------------------------------ resumo
	console.log('\nResumo');
	console.log('─'.repeat(78));
	console.log(
		`  média ${(soma / total).toFixed(1)} · mediana ${percentil(contagens, 50)} · p90 ${percentil(contagens, 90)} · p99 ${percentil(contagens, 99)}`,
	);
	console.log(`  mínimo ${contagens[0]} · máximo ${contagens[total - 1]}`);

	// ------------------------------------------------------- de onde vem o número
	/*
	 * **O painel assume um máximo, e um máximo depende de como se conta.** Esta secção existe porque
	 * o comentário da grelha fala em "90 famílias" e o maior ecrã medido aqui tem bem menos. As duas
	 * contas que inflacionam são juntar os dias da semana no mesmo turno, e contar rotas de fichas
	 * arquivadas — que o painel não desenha. Ver as duas, lado a lado, evita afinar o desenho para um
	 * número que nunca esteve no ecrã.
	 */
	const todas = await cliente.searchRead<Rota>(modelo, [], {
		fields: ['company_id', 'resource_calendar_id', 'week_day'],
		limit: LIMITE,
		lang: LINGUA,
		context: { allowed_company_ids: empresas },
	});

	function maiorAgrupando(linhas: readonly Rota[], comDia: boolean): number {
		const contas = new Map<string, number>();
		for (const l of linhas) {
			const turno = many2oneId(l.resource_calendar_id);
			const empresa = many2oneId(l.company_id);
			if (turno === null || empresa === null) continue;
			const chave = comDia ? `${empresa}|${turno}|${l.week_day}` : `${empresa}|${turno}`;
			contas.set(chave, (contas.get(chave) ?? 0) + 1);
		}
		return Math.max(0, ...contas.values());
	}

	console.log('\nDe onde vem o máximo, conforme se conta');
	console.log('─'.repeat(78));
	console.log(`  ficha activa, por dia da semana  ${String(maiorAgrupando(rotas, true)).padStart(4)}   <- é isto que um ecrã mostra`);
	console.log(`  ficha activa, turno todo         ${String(maiorAgrupando(rotas, false)).padStart(4)}`);
	console.log(`  todas as rotas, por dia          ${String(maiorAgrupando(todas, true)).padStart(4)}`);
	console.log(`  todas as rotas, turno todo       ${String(maiorAgrupando(todas, false)).padStart(4)}`);
	console.log(`  (${todas.length} rotas no total, ${todas.length - rotas.length} delas com a ficha arquivada)`);

	// ------------------------------------------------------------------ degraus
	const cortes = CORTES[area];
	const nomes = ['folgada', 'normal', 'apertada', 'cheia'];
	console.log('\nEm que degrau do painel cai cada ecrã');
	console.log('─'.repeat(78));
	for (const [i, degrau] of nomes.entries()) {
		const de = i === 0 ? 1 : (cortes[i - 1] as number) + 1;
		const ate = i < cortes.length ? (cortes[i] as number) : Infinity;
		const quantos = contagens.filter((c) => c >= de && c <= ate).length;
		const rotulo = ate === Infinity ? `${de}+` : `${de}–${ate}`;
		console.log(
			`  ${degrau.padEnd(9)} ${rotulo.padStart(7)}  ${String(quantos).padStart(5)} ecrãs  ${((quantos / total) * 100).toFixed(2).padStart(6)}%`,
		);
	}

	return 0;
}

process.exitCode = await main();
