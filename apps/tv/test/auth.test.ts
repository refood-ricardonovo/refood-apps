import { describe, expect, it } from 'vitest';
import {
	canTransition,
	deviceOrdinal,
	deviceOrdinals,
	ESTADOS_VIVOS,
	evaluatePairing,
	expiresAt,
	generateCode,
	generateDeviceSecret,
	generateToken,
	hasExpired,
	MAX_TENTATIVAS_CODIGO,
	PREFIXO_SEGREDO,
	PREFIXO_TOKEN,
	sha256Hex,
	transition,
	VALIDADE_MS,
	type Aleatorio,
	type EstadoEmparelhamento,
	type LinhaDispositivo,
} from '../src/auth';

/** Fonte de aleatoriedade determinista: devolve os buffers dados, pela ordem dada. */
function fonteFixa(...buffers: readonly number[][]): Aleatorio {
	let indice = 0;
	return (buffer) => {
		const proximo = buffers[Math.min(indice++, buffers.length - 1)]!;
		buffer.set(proximo.slice(0, buffer.length));
	};
}

/** Uint32 big-endian em bytes, que é como o `generateCode` lê o buffer. */
function uint32(valor: number): number[] {
	return [(valor >>> 24) & 0xff, (valor >>> 16) & 0xff, (valor >>> 8) & 0xff, valor & 0xff];
}

describe('generateDeviceSecret e generateToken', () => {
	it('trazem 32 bytes de entropia em base64url sem padding', () => {
		const segredo = generateDeviceSecret();
		const corpo = segredo.slice(PREFIXO_SEGREDO.length);

		expect(segredo.startsWith(PREFIXO_SEGREDO)).toBe(true);
		expect(corpo).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes em base64, sem os '=' finais
		expect(corpo).not.toContain('=');
	});

	it('distinguem-se pelo prefixo, para um não passar pelo outro sem se dar por isso', () => {
		expect(generateToken().startsWith(PREFIXO_TOKEN)).toBe(true);
		expect(generateToken().startsWith(PREFIXO_SEGREDO)).toBe(false);
	});

	it('não se repetem', () => {
		const gerados = new Set(Array.from({ length: 500 }, () => generateDeviceSecret()));
		expect(gerados.size).toBe(500);
	});

	it('codifica os bytes que recebe, incluindo os extremos', () => {
		const zeros = generateDeviceSecret(fonteFixa(Array<number>(32).fill(0x00)));
		const uns = generateDeviceSecret(fonteFixa(Array<number>(32).fill(0xff)));

		expect(zeros).toBe(PREFIXO_SEGREDO + 'A'.repeat(43));
		expect(uns.slice(PREFIXO_SEGREDO.length)).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(uns).not.toBe(zeros);
	});
});

describe('generateCode', () => {
	it('são sempre 6 dígitos', () => {
		for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^\d{6}$/);
	});

	it('preserva os zeros à cabeça — o código é texto, não um número', () => {
		expect(generateCode(fonteFixa(uint32(4217)))).toBe('004217');
		expect(generateCode(fonteFixa(uint32(0)))).toBe('000000');
		expect(generateCode(fonteFixa(uint32(999_999)))).toBe('999999');
	});

	it('rejeita os valores que enviesariam o resto da divisão, em vez de os dobrar', () => {
		// 4_294_000_000 está acima do limite: seria aceite por um `% 1e6` ingénuo e devolveria
		// '000000' com o dobro da probabilidade. Aqui é descartado e sorteia-se outra vez.
		const codigo = generateCode(fonteFixa(uint32(4_294_000_000), uint32(123_456)));
		expect(codigo).toBe('123456');
	});

	it('cobre a gama toda, incluindo os códigos baixos', () => {
		const amostra = Array.from({ length: 3000 }, () => generateCode());
		expect(amostra.some((codigo) => codigo.startsWith('0'))).toBe(true);
		expect(new Set(amostra).size).toBeGreaterThan(2900); // 1e6 hipóteses: repetições são raras
	});
});

describe('sha256Hex', () => {
	it('bate certo com os vectores conhecidos do SHA-256', async () => {
		expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
		expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
	});

	it('devolve 64 caracteres hex minúsculos — a forma que entra na coluna e no índice', async () => {
		expect(await sha256Hex(generateDeviceSecret())).toMatch(/^[0-9a-f]{64}$/);
	});

	it('é estável: o mesmo segredo dá sempre o mesmo hash, que é o que a procura exige', async () => {
		const segredo = generateDeviceSecret();
		expect(await sha256Hex(segredo)).toBe(await sha256Hex(segredo));
	});

	it('distingue valores próximos', async () => {
		expect(await sha256Hex('seg_abc')).not.toBe(await sha256Hex('seg_abd'));
	});

	it('não deixa o segredo aparecer no hash', async () => {
		const segredo = generateDeviceSecret();
		expect(await sha256Hex(segredo)).not.toContain(segredo.slice(PREFIXO_SEGREDO.length, 12));
	});
});

describe('expiresAt', () => {
	it('soma a validade e devolve ISO em UTC', () => {
		expect(expiresAt(new Date('2026-09-05T10:00:00.000Z'))).toBe('2026-09-05T10:15:00.000Z');
	});

	it('mantém a janela em 15 minutos', () => {
		expect(VALIDADE_MS).toBe(15 * 60 * 1000);
	});

	it('ordena como texto pela mesma ordem em que ordena no tempo — o índice conta com isso', () => {
		const cedo = expiresAt(new Date('2026-09-05T09:59:59.000Z'));
		const tarde = expiresAt(new Date('2026-09-05T10:00:00.000Z'));
		expect(cedo < tarde).toBe(true);
	});

	it('aceita outra validade, para as rotas não terem de reimplementar a soma', () => {
		expect(expiresAt(new Date('2026-09-05T10:00:00.000Z'), 60_000)).toBe('2026-09-05T10:01:00.000Z');
	});
});

describe('hasExpired', () => {
	const agora = new Date('2026-09-05T10:00:00.000Z');

	it('não caducou enquanto falta tempo', () => {
		expect(hasExpired({ estado: 'pendente', expira_em: '2026-09-05T10:00:01.000Z' }, agora)).toBe(false);
	});

	it('caduca no instante exacto — falha fechado na fronteira', () => {
		expect(hasExpired({ estado: 'pendente', expira_em: '2026-09-05T10:00:00.000Z' }, agora)).toBe(true);
	});

	it('caduca depois do prazo, e também para um aprovado que ninguém recolheu', () => {
		expect(hasExpired({ estado: 'pendente', expira_em: '2026-09-05T09:59:59.000Z' }, agora)).toBe(true);
		expect(hasExpired({ estado: 'aprovado', expira_em: '2026-09-05T09:59:59.000Z' }, agora)).toBe(true);
	});

	it('não mexe nos estados terminais: um recolhido não passa a caducado', () => {
		expect(hasExpired({ estado: 'recolhido', expira_em: '2026-01-01T00:00:00.000Z' }, agora)).toBe(false);
		expect(hasExpired({ estado: 'expirado', expira_em: '2026-01-01T00:00:00.000Z' }, agora)).toBe(false);
	});

	it('trata uma data ilegível como caducada', () => {
		expect(hasExpired({ estado: 'pendente', expira_em: 'nao-e-uma-data' }, agora)).toBe(true);
		expect(hasExpired({ estado: 'pendente', expira_em: '' }, agora)).toBe(true);
	});

	it('só olha para os estados que ocupam código e segredo', () => {
		expect([...ESTADOS_VIVOS]).toEqual(['pendente', 'aprovado']);
	});
});

describe('contrato da varredura de caducidade', () => {
	const agora = new Date('2026-09-05T10:00:00.000Z');
	const fora = '2026-09-05T09:55:00.000Z';

	// O que a varredura do Bloco 3 tem de cumprir, fixado aqui para não se descobrir tarde: se ela
	// filtrar só por estado = 'pendente' — que é a query óbvia — um emparelhamento aprovado e nunca
	// recolhido fica vivo para sempre, a segurar o código e o segredo nos índices únicos parciais.
	it('todos os estados vivos caducam e podem transitar para expirado', () => {
		for (const estado of ESTADOS_VIVOS) {
			expect(hasExpired({ estado, expira_em: fora }, agora), `${estado} fora de prazo`).toBe(true);
			expect(canTransition(estado, 'expirado'), `${estado} → expirado`).toBe(true);
			expect(evaluatePairing({ estado, expira_em: fora }, agora), `${estado} avaliado`).toBe('expirado');
		}
	});

	it('nenhum estado terminal precisa de ser varrido', () => {
		for (const estado of ['recolhido', 'expirado'] as const) {
			expect(hasExpired({ estado, expira_em: fora }, agora)).toBe(false);
			expect(canTransition(estado, 'expirado')).toBe(false);
		}
	});

	it('o tecto de tentativas de código é pequeno: uma colisão persistente é avaria, não azar', () => {
		expect(MAX_TENTATIVAS_CODIGO).toBeGreaterThanOrEqual(3);
		expect(MAX_TENTATIVAS_CODIGO).toBeLessThanOrEqual(10);
	});
});

describe('canTransition e transition', () => {
	const estados: EstadoEmparelhamento[] = ['pendente', 'aprovado', 'recolhido', 'expirado'];
	const validas = new Set(['pendente>aprovado', 'pendente>expirado', 'aprovado>recolhido', 'aprovado>expirado']);

	it('permite exactamente as transições do fluxo, e mais nenhuma', () => {
		for (const de of estados) {
			for (const para of estados) {
				expect(canTransition(de, para), `${de} → ${para}`).toBe(validas.has(`${de}>${para}`));
			}
		}
	});

	it('não deixa recolher duas vezes o mesmo emparelhamento', () => {
		expect(canTransition('recolhido', 'recolhido')).toBe(false);
		expect(() => transition('recolhido', 'recolhido')).toThrow(TypeError);
	});

	it('não ressuscita um expirado', () => {
		expect(() => transition('expirado', 'aprovado')).toThrow(/Transição inválida/);
		expect(() => transition('expirado', 'pendente')).toThrow(/Transição inválida/);
	});

	it('não salta a aprovação: um pendente não se recolhe', () => {
		expect(() => transition('pendente', 'recolhido')).toThrow(/'pendente' → 'recolhido'/);
	});

	it('devolve o novo estado quando a transição é válida', () => {
		expect(transition('pendente', 'aprovado')).toBe('aprovado');
		expect(transition('aprovado', 'recolhido')).toBe('recolhido');
	});
});

describe('evaluatePairing', () => {
	const agora = new Date('2026-09-05T10:00:00.000Z');
	const dentro = '2026-09-05T10:05:00.000Z';
	const fora = '2026-09-05T09:55:00.000Z';

	it('pendente enquanto a sede não aprovou', () => {
		expect(evaluatePairing({ estado: 'pendente', expira_em: dentro }, agora)).toBe('pendente');
	});

	it('pronto quando está aprovado e dentro da validade', () => {
		expect(evaluatePairing({ estado: 'aprovado', expira_em: dentro }, agora)).toBe('pronto');
	});

	it('um aprovado fora de prazo não emite token — a aprovação não estica a validade', () => {
		expect(evaluatePairing({ estado: 'aprovado', expira_em: fora }, agora)).toBe('expirado');
	});

	it('um pendente fora de prazo já conta como expirado antes de a base o marcar', () => {
		// A caducidade é lazy: na base a linha ainda diz 'pendente'. A decisão não espera pela varredura.
		expect(evaluatePairing({ estado: 'pendente', expira_em: fora }, agora)).toBe('expirado');
	});

	it('respeita o que já está marcado na base', () => {
		expect(evaluatePairing({ estado: 'expirado', expira_em: dentro }, agora)).toBe('expirado');
		expect(evaluatePairing({ estado: 'recolhido', expira_em: dentro }, agora)).toBe('recolhido');
	});

	it('recolhido ganha à caducidade: o código foi usado, e é isso que se quer dizer à TV', () => {
		expect(evaluatePairing({ estado: 'recolhido', expira_em: fora }, agora)).toBe('recolhido');
	});
});

describe('deviceOrdinals', () => {
	const linhas: LinhaDispositivo[] = [
		{ id: 'c', company_id: 7, criado_em: '2026-03-01T08:00:00.000Z' },
		{ id: 'a', company_id: 7, criado_em: '2026-01-01T08:00:00.000Z' },
		{ id: 'b', company_id: 7, criado_em: '2026-02-01T08:00:00.000Z' },
	];

	it('numera pela ordem de emparelhamento, não pela ordem em que a query devolveu', () => {
		expect([...deviceOrdinals(linhas, 7)]).toEqual([
			['a', 1],
			['b', 2],
			['c', 3],
		]);
	});

	it('conta as revogadas: os números dos outros ecrãs não mexem quando um é revogado', () => {
		const semORevogado = linhas.filter((linha) => linha.id !== 'b');
		const comTodas = deviceOrdinals(linhas, 7);

		// 'b' foi revogado. Se a lista da monitorização esconder a linha, 'c' continua a ser o 3,
		// e a numeração dos que sobram fica com um buraco no 2 — que é o registo da revogação.
		expect(comTodas.get('c')).toBe(3);
		expect(semORevogado.map((linha) => comTodas.get(linha.id)).sort()).toEqual([1, 3]);

		// O contraste, para deixar escrito o erro que isto evita: numerar só as visíveis puxava o 'c' para 2.
		expect(deviceOrdinals(semORevogado, 7).get('c')).toBe(2);
	});

	it('desempata pelo id quando duas linhas nascem no mesmo milissegundo', () => {
		const gemeas: LinhaDispositivo[] = [
			{ id: 'z', company_id: 7, criado_em: '2026-01-01T08:00:00.000Z' },
			{ id: 'y', company_id: 7, criado_em: '2026-01-01T08:00:00.000Z' },
		];
		expect(deviceOrdinals(gemeas, 7).get('y')).toBe(1);
		expect(deviceOrdinals([...gemeas].reverse(), 7).get('y')).toBe(1);
	});

	it('rebenta se a lista trouxer uma linha de outro núcleo', () => {
		const misturadas = [...linhas, { id: 'x', company_id: 9, criado_em: '2026-04-01T08:00:00.000Z' }];
		expect(() => deviceOrdinals(misturadas, 7)).toThrow(/empresa 9, não da 7/);
	});

	it('não altera a lista que recebe', () => {
		const original = [...linhas];
		deviceOrdinals(linhas, 7);
		expect(linhas).toEqual(original);
	});

	it('aceita um núcleo sem dispositivos', () => {
		expect(deviceOrdinals([], 7).size).toBe(0);
	});
});

describe('deviceOrdinal', () => {
	const linhas: LinhaDispositivo[] = [
		{ id: 'a', company_id: 7, criado_em: '2026-01-01T08:00:00.000Z' },
		{ id: 'b', company_id: 7, criado_em: '2026-02-01T08:00:00.000Z' },
	];

	it('devolve o número do dispositivo', () => {
		expect(deviceOrdinal(linhas, 7, 'b')).toBe(2);
	});

	it('devolve null para um id que não está na lista', () => {
		expect(deviceOrdinal(linhas, 7, 'desconhecido')).toBeNull();
	});
});
