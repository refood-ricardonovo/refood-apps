/**
 * Um `D1Database` mínimo por cima do `node:sqlite`, para os testes correrem contra as queries a
 * sério — com os índices, os `CHECK` e as chaves estrangeiras que a migração criou.
 *
 * Porquê isto e não o pool de Workers: o que estas rotas têm de particular está no SQL — o índice
 * único parcial que liberta o código, a inserção condicionada que garante o uso único, a varredura
 * que tem de apanhar os dois estados vivos. Nada disso se testa com um duplo de mentira, e tudo
 * isso é SQLite, que é o que o D1 é por baixo. As migrações que se aplicam aqui são as mesmas que
 * correram em staging, lidas do disco.
 *
 * O que este duplo **não** cobre, e convém não esquecer: limites de tamanho do D1, latência, e o
 * comportamento dele quando o `batch` falha a meio. Se algum dia isso importar, a substituição é
 * pelo `@cloudflare/vitest-pool-workers`, e os testes que usam este ficheiro não mudam.
 *
 * **É cópia do `apps/tv/test/d1-falso.ts`, e é a segunda.** As duas apps não partilham pasta de
 * testes, e o sítio de partilhar seria `packages/`; a dois consumidores o pacote custa mais do que
 * a cópia. **Ao terceiro, cria-se `packages/d1-falso`** — o mesmo gatilho que está escrito para a
 * fonte Inter, no `CLAUDE.md` desta app.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * As migrações estão na raiz do monorepo — `apps/app/test/` → três níveis acima. A base é
 * partilhada com o `apps/tv`, portanto o esquema é do monorepo e não desta app.
 *
 * **Isto monta o esquema inteiro, incluindo tabelas que esta app nunca toca, e é deliberado.**
 * Uma base partilhada testada contra metade do esquema é pior do que não a testar: uma migração
 * da TV que colida com o que esta app lê tem de aparecer aqui, a vermelho, e não em produção. O
 * preço é que uma migração da TV pode partir os testes desta app — é essa a rede, não um efeito
 * secundário a corrigir.
 */
const MIGRACOES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations');

type Parametro = string | number | null;

class DeclaracaoFalsa {
	constructor(
		private readonly base: DatabaseSync,
		private readonly sql: string,
		private readonly parametros: Parametro[] = [],
	) {}

	bind(...parametros: Parametro[]): DeclaracaoFalsa {
		return new DeclaracaoFalsa(this.base, this.sql, parametros);
	}

	async first<T>(): Promise<T | null> {
		const linha = this.base.prepare(this.sql).get(...this.parametros);
		return linha === undefined ? null : ({ ...linha } as T);
	}

	async all<T>(): Promise<{ results: T[]; success: true; meta: { changes: number } }> {
		const linhas = this.base.prepare(this.sql).all(...this.parametros);
		return { results: linhas.map((linha) => ({ ...linha }) as T), success: true, meta: { changes: 0 } };
	}

	async run(): Promise<{ results: never[]; success: true; meta: { changes: number; last_row_id: number } }> {
		const resultado = this.base.prepare(this.sql).run(...this.parametros);
		return {
			results: [],
			success: true,
			meta: { changes: Number(resultado.changes), last_row_id: Number(resultado.lastInsertRowid) },
		};
	}
}

class BaseFalsa {
	constructor(private readonly base: DatabaseSync) {}

	prepare(sql: string): DeclaracaoFalsa {
		return new DeclaracaoFalsa(this.base, sql);
	}

	/** Como no D1: as declarações do lote correm numa transação, e ou entram todas ou não entra nenhuma. */
	async batch<T = unknown>(declaracoes: DeclaracaoFalsa[]): Promise<T[]> {
		this.base.exec('BEGIN');
		try {
			const resultados: unknown[] = [];
			for (const declaracao of declaracoes) resultados.push(await declaracao.run());
			this.base.exec('COMMIT');
			return resultados as T[];
		} catch (erro) {
			this.base.exec('ROLLBACK');
			throw erro;
		}
	}

	/** Atalho só para os testes prepararem cenários e lerem o que ficou na base. */
	sql(consulta: string, ...parametros: Parametro[]): Record<string, unknown>[] {
		return this.base
			.prepare(consulta)
			.all(...parametros)
			.map((linha) => ({ ...linha }));
	}
}

export type D1Falso = BaseFalsa & D1Database;

/** Uma base nova em memória, com todas as migrações de `migrations/` aplicadas por ordem de nome. */
export function novaBase(): D1Falso {
	const base = new DatabaseSync(':memory:');

	// O D1 tem as chaves estrangeiras ligadas; o SQLite não, por omissão. Sem isto, um
	// `dispositivo_id` a apontar para nada passaria aqui e rebentaria em produção.
	base.exec('PRAGMA foreign_keys = ON');

	for (const ficheiro of readdirSync(MIGRACOES)
		.filter((nome) => nome.endsWith('.sql'))
		.sort()) {
		base.exec(readFileSync(join(MIGRACOES, ficheiro), 'utf8'));
	}

	return new BaseFalsa(base) as D1Falso;
}
