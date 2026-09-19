import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

/**
 * Põe o `painel.html` num browser a sério e traz de volta as medidas dos degraus.
 *
 * **Porquê um browser, num repositório que não tem nenhum.** A largura mínima de um cartão é uma
 * largura de texto: depende das métricas da Inter, do `min-content` de uma grelha de duas colunas e
 * de um `white-space: nowrap`. Não há conta que a dê, e um DOM sem layout — `jsdom`, `happy-dom` —
 * devolve zero a tudo o que se lhe pergunte. Ou se mede num motor de layout, ou não se mede.
 *
 * O que isto **não** faz é trazer uma dependência nova: fala com o Chrome que já está na máquina,
 * pela linha de comandos, com `--dump-dom`. A página de medida escreve o resultado em JSON dentro
 * do próprio DOM e é de lá que ele sai.
 *
 * **Sem Chrome, isto falha — não salta.** Um teste que se ignora a si próprio quando não pode
 * correr é a forma mais silenciosa de todas de um defeito passar, e é precisamente o padrão que
 * estes testes existem para fechar. A mensagem diz o que falta e como apontar para um browser.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const PUBLICO = resolve(AQUI, '..', '..', 'public');
const PAGINA = join(AQUI, 'medir.html');

const TIPOS: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.woff2': 'font/woff2',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
};

/**
 * Onde procurar o browser. O `CHROME` do ambiente ganha a tudo — é o que permite correr isto num
 * sítio onde ele esteja noutro lado, sem mexer no código.
 */
function encontrarBrowser(): string {
	const doAmbiente = process.env.CHROME ?? process.env.CHROME_PATH;
	if (doAmbiente) {
		if (!existsSync(doAmbiente)) throw new Error(`CHROME aponta para ${doAmbiente}, que não existe.`);
		return doAmbiente;
	}

	const candidatos =
		process.platform === 'win32'
			? [
					'C:/Program Files/Google/Chrome/Application/chrome.exe',
					'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
					'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
					'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
				]
			: process.platform === 'darwin'
				? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
				: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];

	const achado = candidatos.find((caminho) => existsSync(caminho));
	if (achado) return achado;

	throw new Error(
		'Não há Chrome nem Edge nesta máquina, e estas medidas precisam de um motor de layout — ' +
			'a largura mínima de um cartão é uma largura de texto e não se calcula.\n' +
			'Aponta para um browser com a variável de ambiente CHROME=<caminho>.\n' +
			`Procurou-se em:\n${candidatos.map((c) => `  ${c}`).join('\n')}`,
	);
}

/** Serve o `public/` da app, mais a página de medida em `/medir.html`. Porta ao acaso. */
async function servir() {
	const servidor = createServer(async (pedido, resposta) => {
		const caminho = new URL(pedido.url ?? '/', 'http://local').pathname;
		const alvo = caminho === '/medir.html' ? PAGINA : join(PUBLICO, caminho);

		/* Nada fora das duas raízes, nem por um `..` no caminho. */
		if (alvo !== PAGINA && !resolve(alvo).startsWith(PUBLICO)) {
			resposta.writeHead(403).end();
			return;
		}

		try {
			const corpo = await readFile(alvo);
			resposta.writeHead(200, { 'content-type': TIPOS[extname(alvo)] ?? 'application/octet-stream' });
			resposta.end(corpo);
		} catch {
			resposta.writeHead(404).end('não há');
		}
	});

	await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto));
	const porta = (servidor.address() as AddressInfo).port;

	return {
		porta,
		fechar: () => new Promise<void>((pronto) => servidor.close(() => pronto())),
	};
}

export interface Medida {
	readonly chave: string;
	readonly minimo: number;
	readonly altura: number;
}

export interface Degrau {
	readonly area: 'entregas' | 'recolhas';
	readonly densidade: string;
	/** Até quantos cartões este degrau serve. `null` no último, que não tem tecto. */
	readonly ate: number | null;
	readonly colunas: number;
	readonly tecto: number;
	readonly folga: number;
	readonly tectoDeAltura: number | null;
	/** A maior largura mínima entre todas as amostras — a que decide a coluna. */
	readonly minimo: number;
	readonly minimoDe: string;
	readonly altura: number;
	readonly medidas: readonly Medida[];
}

/** O que o contador de "fora do ecrã" do painel disse, para um certo número de cartões desenhados. */
export interface ProvaDoAviso {
	readonly pedidos: number;
	readonly contador: number;
	readonly escondido: boolean;
}

export interface Leitura {
	/** Lugares do degrau mais denso das entregas: colunas × linhas que cabem. */
	readonly lugares: number;
	/** Duas provas do aviso: uma à capacidade exacta, outra doze cartões acima dela. */
	readonly aviso: readonly ProvaDoAviso[];
	readonly janela: { largura: number; altura: number; dpr: number };
	/** A largura que a grelha tem mesmo, lida do layout: 1872px num 1080p. */
	readonly disponivel: number;
	readonly alturaDisponivel: number;
	readonly degraus: readonly Degrau[];
	readonly montagem: {
		folhas: number;
		margemDoCorpo: string;
		inter: boolean;
		temGrelha: boolean;
		temConstrutores: boolean;
	};
}

/**
 * O que o Chrome tira à janela, entre o `--window-size` que se lhe pede e o `innerWidth` que a
 * página vê. Mesmo em `headless` não é zero, e **não é um número que se possa escrever aqui**:
 * muda com a versão e com a plataforma. Mede-se uma vez por processo e usa-se a seguir.
 *
 * Uma constante em vez disto foi o primeiro defeito deste ficheiro: escrita a partir de uma
 * medição, deixou de valer mal se acrescentou `--no-first-run`, e o teste passou a medir uma
 * janela de 1024 de altura a dizer que media 1080.
 */
let folgaDaJanela: { largura: number; altura: number } | null = null;

/** Mede com o `--window-size` exactamente como é pedido, sem compensar nada. */
async function corrida(largura: number, altura: number): Promise<Leitura> {
	const browser = encontrarBrowser();
	const servidor = await servir();
	const perfil = await mkdtemp(join(tmpdir(), 'refood-medida-'));

	try {
		const argumentos = [
			'--headless=new',
			'--disable-gpu',
			'--no-sandbox',
			'--hide-scrollbars',
			'--no-first-run',
			`--user-data-dir=${perfil}`,
			'--virtual-time-budget=10000',
			`--window-size=${largura},${altura}`,
			'--dump-dom',
			`http://127.0.0.1:${servidor.porta}/medir.html`,
		];

		const dom = await new Promise<string>((pronto, falhou) => {
			const processo = spawn(browser, argumentos, { stdio: ['ignore', 'pipe', 'ignore'] });
			let saida = '';
			processo.stdout.setEncoding('utf8');
			processo.stdout.on('data', (pedaco: string) => (saida += pedaco));
			processo.on('error', falhou);
			processo.on('close', () => pronto(saida));
		});

		const encontrado = /<pre id="resultado">([\s\S]*?)<\/pre>/.exec(dom);
		if (!encontrado) {
			throw new Error(`A página de medida não chegou ao fim. O que o browser devolveu:\n${dom.slice(0, 2000)}`);
		}

		const leitura = JSON.parse(desescapar(encontrado[1])) as Leitura & { erro?: string };
		if (leitura.erro) throw new Error(`A medição rebentou dentro do browser:\n${leitura.erro}`);

		return leitura;
	} finally {
		await servidor.fechar();
		await rm(perfil, { recursive: true, force: true });
	}
}

/**
 * Mede os degraus com a janela **exactamente** ao tamanho pedido, em píxeis CSS.
 *
 * A primeira chamada de cada processo gasta uma corrida a descobrir quanto é que o Chrome tira à
 * janela; daí em diante compensa com esse valor. Se ainda assim a página não vir o tamanho pedido,
 * **isto rebenta em vez de devolver a medição** — uma medida tirada noutro tamanho não é um
 * resultado pior, é um resultado de outra coisa, e todo este ficheiro existe porque números assim
 * passam despercebidos.
 */
export async function medirDegraus(largura: number, altura: number): Promise<Leitura> {
	if (!folgaDaJanela) {
		const sonda = await corrida(largura, altura);
		folgaDaJanela = { largura: largura - sonda.janela.largura, altura: altura - sonda.janela.altura };
		if (folgaDaJanela.largura === 0 && folgaDaJanela.altura === 0) return sonda;
	}

	const leitura = await corrida(largura + folgaDaJanela.largura, altura + folgaDaJanela.altura);

	if (leitura.janela.largura !== largura || leitura.janela.altura !== altura) {
		throw new Error(
			`Pediu-se uma janela de ${largura} × ${altura} px CSS e o browser deu ${leitura.janela.largura} × ${leitura.janela.altura}, ` +
				`mesmo depois de compensar ${folgaDaJanela.largura} × ${folgaDaJanela.altura}. ` +
				'Sem o tamanho certo as medidas são de outro ecrã e não dizem nada sobre este.',
		);
	}

	return leitura;
}

/** O `--dump-dom` devolve HTML, e o JSON lá dentro vem com as entidades escapadas. */
function desescapar(texto: string): string {
	return texto.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&');
}
