import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Custo } from '../types'

// Como funciona:
// 1. A app dá o custo da sessão em dólares de API (o mesmo do /cost), exato por sessão.
// 2. Todas as sessões somam os dólares que gastam num registo partilhado. Sempre que a %
//    semanal sobe, a mod divide esses dólares pelos pontos que subiram: fica a saber quantos
//    dólares de API vale 1 ponto da semana. Usa a mediana das últimas leituras.
// 3. Custo da sessão = dólares ÷ dólares por ponto × (preço mensal ÷ 4 ÷ 100).

const AMOSTRAS = 25

const custo = atom({ plugin: 'custo-sessao', key: 'custo' } as const, {
  usd: 0,
  usdPorPonto: null,
  isMeasured: false,
} as Custo)

/** Por sessão: dólares acumulados e o último total que a app reportou neste processo. */
type Sessao = { usd: number; ultimoTotal: number }

/** Partilhado: dólares gastos desde a última subida da % semanal e o que já se aprendeu. */
type Calibracao = {
  pendente: number
  semana: number | null
  /** A primeira subida depois de começar a contar apanha um ponto a meio: não serve. */
  isPrimeira: boolean
  amostras: number[]
}

const CAL_VAZIA: Calibracao = { pendente: 0, semana: null, isPrimeira: true, amostras: [] }

const semanaDe = (limits: readonly SessionRateLimit[]) =>
  limits.find(l => l.kind === 'seven_day')?.percentUsed

const mediana = (xs: readonly number[]) => {
  if (xs.length === 0) return null
  const ord = [...xs].sort((a, b) => a - b)
  const meio = Math.floor(ord.length / 2)
  return ord.length % 2 ? ord[meio]! : (ord[meio - 1]! + ord[meio]!) / 2
}

const pontos = (pct: number) => pct.toLocaleString('pt-PT', { maximumFractionDigits: 1 })

export const register: Register = (on, options) => {
  const mensal = Number(options.precoMensal) > 0 ? Number(options.precoMensal) : 25
  const moeda = options.moeda === 'USD' ? 'USD' : 'EUR'
  const porPonto = mensal / 4 / 100

  const plano: Plano = { porPonto, moeda }

  on('session.start', async ($, e, next) => {
    const id = await $.session.id()
    const guardada = (await $.store.get(`s:${id}`)) as Partial<Sessao> | undefined
    // O que a app já conta neste processo: numa sessão que recebeu a mod a meio, é o que gastou antes.
    const inicial = (await $.session.usage()).cost?.usd ?? 0
    let sessao: Sessao

    if (typeof guardada?.usd !== 'number') {
      // Sessão nova para a mod: o gasto anterior conta para ela, mas não para a calibração.
      sessao = { usd: inicial, ultimoTotal: inicial }
    } else if (inicial >= (guardada.ultimoTotal ?? 0)) {
      // Mesmo processo (a mod foi recarregada): continua de onde estava, sem somar outra vez.
      sessao = { usd: guardada.usd, ultimoTotal: guardada.ultimoTotal ?? 0 }
    } else {
      // Processo novo (sessão reaberta): o total da app recomeçou.
      sessao = { usd: guardada.usd, ultimoTotal: 0 }
    }
    await $.store.set(`s:${id}`, sessao)

    // A versão 0.2.0 meteu na calibração o gasto anterior das sessões: recomeça-se a contar.
    let cal = ((await $.store.get('cal')) as Calibracao | undefined) ?? CAL_VAZIA
    if ((await $.store.get('calVersao')) !== 2) {
      cal = { ...cal, pendente: 0, isPrimeira: true, amostras: [] }
      await $.store.set('cal', cal)
      await $.store.set('calVersao', 2)
    }

    await update($, custo, () => ({
      usd: sessao.usd,
      usdPorPonto: mediana(cal.amostras),
      isMeasured: sessao.usd > 0,
    }))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const id = await $.session.id()
    const sessao = ((await $.store.get(`s:${id}`)) as Sessao | undefined) ?? { usd: 0, ultimoTotal: 0 }
    const total = e.cost?.usd ?? sessao.ultimoTotal
    // Se o total da app desceu, o processo recomeçou: tudo o que reporta agora é novo.
    const gasto = total >= sessao.ultimoTotal ? total - sessao.ultimoTotal : total
    const usd = sessao.usd + gasto
    await $.store.set(`s:${id}`, { usd, ultimoTotal: total } satisfies Sessao)

    const cal: Calibracao = { ...CAL_VAZIA, ...((await $.store.get('cal')) as Calibracao | undefined) }
    cal.pendente += gasto
    const semana = semanaDe(e.rateLimits)

    if (semana !== undefined) {
      if (cal.semana === null || semana < cal.semana) {
        // Primeira leitura ou a semana recomeçou: conta-se a partir daqui.
        Object.assign(cal, { semana, pendente: 0, isPrimeira: true })
      } else if (semana > cal.semana) {
        if (!cal.isPrimeira && cal.pendente > 0) {
          cal.amostras = [...cal.amostras, cal.pendente / (semana - cal.semana)].slice(-AMOSTRAS)
        }
        Object.assign(cal, { semana, pendente: 0, isPrimeira: false })
      }
    }

    await $.store.set('cal', cal)
    await update($, custo, () => ({ usd, usdPorPonto: mediana(cal.amostras), isMeasured: true }))

    return next(e)
  })

  // A banda tem uma linha por mod: o anel entra na linha dos anéis da skins, ao lado dos outros.
  on('ui.render', { component: 'AbovePrompt', plugin: 'skins' }, async ($, e, next) => {
    const deles = await next(e)
    if (e.surface === 'terminal' || e.props.hasSurvey) return deles
    const fila = filaDosAneis(deles)
    const d = fila ? await desenho($, plano) : null
    if (!fila || !d) return deles

    const { Svg } = $.ui.resolve(e)
    const svg = anel(d.pct ?? 0, d.valor, d.rotulo, coresDe(fila))
    const elemento = <Svg source={svg.source} alt={d.frase} width={svg.width} height={svg.height} />
    return comAnel(deles, fila, elemento as unknown as No) as typeof deles
  })

  // A linha própria só fica quando não há anéis da skins onde entrar (ou no terminal).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const resto = await next(e)
    const d = e.props.hasSurvey ? null : await desenho($, plano)
    if (!d) return resto

    const { Box, Text } = $.ui.resolve(e)

    if (e.surface === 'terminal') {
      return (
        <Box flexDirection="column">
          <Text dimColor>{d.frase}</Text>
          {resto}
        </Box>
      )
    }

    const svg = anel(d.pct ?? 0, d.valor, d.rotulo, PADRAO)
    const { Svg } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {/* "center" e não "space-evenly": esta linha não pode passar por fila dos anéis da skins. */}
        <Box flexDirection="row" alignItems="center" justifyContent="center" paddingRight={5}>
          <Svg source={svg.source} alt={d.frase} width={svg.width} height={svg.height} />
        </Box>
        {resto}
      </Box>
    )
  })

  // Se o anel já entrou na linha da skins, a linha própria sai, para não aparecer duas vezes.
  on('ui.render', { component: 'AbovePromptList' }, async ($, e, next) => {
    const fundida = e.props.rows.find(r => (filaDosAneis(r.tree)?.children ?? []).some(f => eNo(f) && f.type === 'Svg' && !temAnel(f)) && temAnel(r.tree))
    if (!fundida) return next(e)
    const rows = e.props.rows.filter(r => r === fundida || !temAnel(r.tree))
    return next({ ...e, props: { ...e.props, rows } })
  })
}

type Plano = { porPonto: number; moeda: 'EUR' | 'USD' }

const dinheiro = (v: number, moeda: 'EUR' | 'USD') =>
  v.toLocaleString('pt-PT', { style: 'currency', currency: moeda, minimumFractionDigits: 2, maximumFractionDigits: 2 })

// O anel e a frase que valem para as duas linhas: a desta mod e a dos anéis da skins.
async function desenho($: EngineInterface, plano: Plano) {
  const atual = await read($, custo)
  if (!atual.isMeasured) return null
  const pct = atual.usdPorPonto ? atual.usd / atual.usdPorPonto : null
  const api = dinheiro(atual.usd, 'USD')
  const valor = pct === null ? api : dinheiro(pct * plano.porPonto, plano.moeda)
  const rotulo = pct === null ? 'API · a calibrar' : `${api} API · ${pontos(pct)}% semana`
  const frase =
    pct === null
      ? `Esta sessão: ${api} a preço de API. Ainda a aprender quanto vale a tua semana em tokens.`
      : `Esta sessão já custou ${valor} do plano (${pontos(pct)} % da semana), ${api} a preço de API`
  return { pct, valor, rotulo, frase }
}

type No = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

const eNo = (x: unknown): x is No => typeof x === 'object' && x !== null && 'type' in x

// A fila onde a skins espalha os anéis: um Box space-evenly com pelo menos um Svg.
const filaDosAneis = (no: unknown): No | undefined => {
  if (!eNo(no)) return undefined
  const filhos = no.children ?? []
  if (no.type === 'Box' && no.props?.justifyContent === 'space-evenly' && filhos.some(f => eNo(f) && f.type === 'Svg')) {
    return no
  }
  for (const f of filhos) {
    const achado = filaDosAneis(f)
    if (achado) return achado
  }
  return undefined
}

const MARCA = 'data-custo-sessao'

// Se a árvore já tem o anel desta mod.
const temAnel = (no: unknown): boolean => {
  if (!eNo(no)) return false
  if (no.type === 'Svg' && String(no.props?.source ?? '').includes(MARCA)) return true
  return (no.children ?? []).some(temAnel)
}

// Copia a árvore e junta o anel no fim da fila.
const comAnel = (no: unknown, fila: No, anel: No): unknown => {
  if (!eNo(no)) return no
  if (no === fila) return { ...no, children: [...(no.children ?? []), anel] }
  if (!no.children) return no
  return { ...no, children: no.children.map(f => comAnel(f, fila, anel)) }
}

type Cores = { trilho: string; arco: string; texto: string; suave: string }

const PADRAO: Cores = { trilho: '#9a9e9b', arco: '#3ad88a', texto: '#f2f2f2', suave: '#9a9e9b' }

// Lê as cores do primeiro anel da skins, para o tema bater certo.
const coresDe = (fila: No | undefined): Cores => {
  const svg = fila?.children?.find(f => eNo(f) && f.type === 'Svg') as No | undefined
  const fonte = String(svg?.props?.source ?? '')
  const tracos = [...fonte.matchAll(/stroke="(#[0-9a-fA-F]{3,8})"/g)].map(m => m[1])
  const fills = [...fonte.matchAll(/fill:(#[0-9a-fA-F]{3,8})/g)].map(m => m[1])
  return {
    trilho: tracos[0] ?? PADRAO.trilho,
    arco: tracos[1] ?? PADRAO.arco,
    texto: fills[0] ?? PADRAO.texto,
    suave: fills[1] ?? PADRAO.suave,
  }
}

// Anel no mesmo desenho dos da skins: raio 9, traço 3, valor a negrito e rótulo suave.
const anel = (pct: number, valor: string, rotulo: string, c: Cores) => {
  const r = 9
  const volta = 2 * Math.PI * r
  const cheio = (Math.min(Math.max(pct, 0), 100) / 100) * volta
  const largura = Math.ceil(r * 2 + 12 + (valor.length + rotulo.length + 1) * 6.6 + 6)
  const fonte = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Inter, sans-serif"
  const source = `<svg xmlns="http://www.w3.org/2000/svg" ${MARCA}="1" width="${largura}" height="30" viewBox="0 0 ${largura} 30"><style>text{font-family:${fonte}}</style><circle cx="13" cy="15" r="${r}" fill="none" stroke="${c.trilho}" stroke-opacity=".25" stroke-width="3"/><circle cx="13" cy="15" r="${r}" fill="none" stroke="${c.arco}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${cheio.toFixed(2)} ${volta.toFixed(2)}" transform="rotate(-90 13 15)"/><text x="30" y="19.5" font-size="12.5"><tspan style="fill:${c.texto};font-weight:600">${valor}</tspan><tspan style="fill:${c.suave}"> ${rotulo}</tspan></text></svg>`
  return { source, width: largura, height: 30 }
}
