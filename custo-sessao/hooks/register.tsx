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
  /** Quando a janela semanal recomeça (o resetsAt da app): muda quando começa uma semana nova. */
  reinicio?: string | null
  /** A primeira subida depois de começar a contar apanha um ponto a meio: não serve. */
  isPrimeira: boolean
  amostras: number[]
}

const CAL_VAZIA: Calibracao = { pendente: 0, semana: null, reinicio: null, isPrimeira: true, amostras: [] }

// A janela semanal. Nas contas com limite de 5h vem ao lado da `five_hour`, que aqui não conta.
const semanaDe = (limits: readonly SessionRateLimit[]) => limits.find(l => l.kind === 'seven_day')

const SEIS_HORAS = 6 * 3600_000

// Semana nova: o reinício da janela andou para a frente. Sem reinício, só uma descida grande
// (ou o regresso a perto de 0) conta. Uma descida pequena é uma leitura atrasada de outra
// sessão aberta ao mesmo tempo, e antes recomeçava a calibração a cada vez: nunca acabava.
const eSemanaNova = (cal: Calibracao, pct: number, reinicio: string | undefined) => {
  if (cal.semana === null) return true
  const novo = reinicio === undefined ? NaN : Date.parse(reinicio)
  const velho = cal.reinicio ? Date.parse(cal.reinicio) : NaN
  if (!Number.isNaN(novo) && !Number.isNaN(velho)) return novo - velho > SEIS_HORAS
  return pct < cal.semana && (pct <= 1 || cal.semana - pct >= 5)
}

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
    const janela = semanaDe(e.rateLimits)

    if (janela !== undefined) {
      const semana = janela.percentUsed
      if (eSemanaNova(cal, semana, janela.resetsAt)) {
        // Primeira leitura ou a semana recomeçou: conta-se a partir daqui.
        Object.assign(cal, { semana, reinicio: janela.resetsAt ?? null, pendente: 0, isPrimeira: true })
      } else if (cal.semana !== null && semana > cal.semana) {
        if (!cal.isPrimeira && cal.pendente > 0) {
          cal.amostras = [...cal.amostras, cal.pendente / (semana - cal.semana)].slice(-AMOSTRAS)
        }
        Object.assign(cal, { semana, reinicio: janela.resetsAt ?? cal.reinicio ?? null, pendente: 0, isPrimeira: false })
      }
      // Igual ou mais baixa na mesma semana (leitura atrasada de outra sessão): o gasto fica pendente.
    }

    await $.store.set('cal', cal)
    await update($, custo, () => ({ usd, usdPorPonto: mediana(cal.amostras), isMeasured: true }))

    return next(e)
  })

  // A banda tem uma linha por mod: o anel entra na linha dos anéis da skins, ao lado dos outros.
  // Os mods encaixam pela ordem em que estão ativados, o primeiro por fora:
  // - custo-sessao por fora da skins: a linha da skins já vem desenhada e o anel entra na fila;
  // - por dentro: a skins ainda não desenhou nada. O anel vai solto, num Box com a chave
  //   `skins-band:`, e a skins da weTURN.ON (0.5.16-wto.2) muda-o para a fila dos anéis.
  on('ui.render', { component: 'AbovePrompt', plugin: 'skins' }, async ($, e, next) => {
    const deles = await next(e)
    if (e.surface === 'terminal' || e.props.hasSurvey) return deles
    const d = await desenho($, plano)
    if (!d) return deles

    const ui = $.ui.resolve(e)
    const fila = filaDosAneis(deles)
    if (fila) return comAnel(deles, fila, medidor(ui, d, d.curto, arcoDe(fila)) as unknown as No) as typeof deles

    const { Box } = ui
    return (
      <Box flexDirection="column">
        {deles}
        {medidor(ui, d, d.curto, ARCO)}
      </Box>
    ) as typeof deles
  })

  // A linha própria só fica quando não há anéis da skins onde entrar (ou no terminal).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const resto = await next(e)
    const d = e.props.hasSurvey ? null : await desenho($, plano)
    if (!d) return resto

    const ui = $.ui.resolve(e)
    const { Box, Text } = ui

    if (e.surface === 'terminal') {
      return (
        <Box flexDirection="column">
          <Text dimColor>{d.frase}</Text>
          {resto}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {/* "center" e não "space-evenly": esta linha não pode passar por fila dos anéis da skins. */}
        <Box flexDirection="row" alignItems="center" justifyContent="center" paddingRight={5}>
          {medidor(ui, d, d.rotulo, ARCO)}
        </Box>
        {resto}
      </Box>
    )
  })

  // Se o anel já entrou na linha da skins (na fila ou solto), a linha própria sai, para não aparecer duas vezes.
  on('ui.render', { component: 'AbovePromptList' }, async ($, e, next) => {
    const fundida = e.props.rows.find(r => r.plugin !== 'custo-sessao' && temAnel(r.tree))
    if (!fundida) return next(e)
    const rows = e.props.rows.filter(r => r === fundida || !temAnel(r.tree))
    return next({ ...e, props: { ...e.props, rows } })
  })
}

type Plano = { porPonto: number; moeda: 'EUR' | 'USD' }

const dinheiro = (v: number, moeda: 'EUR' | 'USD') =>
  v.toLocaleString('pt-PT', { style: 'currency', currency: moeda, minimumFractionDigits: 2, maximumFractionDigits: 2 })

// O anel e as frases que valem para as duas linhas: a desta mod e a dos anéis da skins.
// `curto` é o rótulo na linha da skins, que já leva três ou quatro anéis e o botão Compact.
// Leva o preço de API: é a comparação com o plano que dá noção do valor da conta.
async function desenho($: EngineInterface, plano: Plano) {
  const atual = await read($, custo)
  if (!atual.isMeasured) return null
  const pct = atual.usdPorPonto ? atual.usd / atual.usdPorPonto : null
  const api = dinheiro(atual.usd, 'USD')
  const valor = pct === null ? api : dinheiro(pct * plano.porPonto, plano.moeda)
  const rotulo = pct === null ? 'API · a calibrar' : `${api} API · ${pontos(pct)}% semana`
  const curto = pct === null ? 'API · a calibrar' : `${api} API · ${pontos(pct)}% semana`
  const frase =
    pct === null
      ? `Esta sessão: ${api} a preço de API. Ainda a aprender quanto vale a tua semana em tokens.`
      : `Esta sessão já custou ${valor} do plano (${pontos(pct)} % da semana), ${api} a preço de API`
  return { pct, valor, rotulo, curto, frase }
}

type Ui = ReturnType<EngineInterface['ui']['resolve']>

// O anel é um SVG só com o círculo; o valor e o rótulo são texto da app, com as cores do tema,
// para se lerem no modo claro e no escuro (um SVG não sabe em que tema está a app).
const medidor = (ui: Ui, d: { pct: number | null; valor: string; frase: string }, rotulo: string, arco: string) => {
  const { Box, Text } = ui
  // Só se desenha fora do terminal, onde a tabela tem Svg.
  const { Svg } = ui as Extract<Ui, { Svg: unknown }>
  const svg = anel(d.pct ?? 0, arco)
  return (
    <Box key={CHAVE} flexDirection="row" alignItems="center" columnGap={1}>
      <Svg source={svg.source} alt={d.frase} width={svg.width} height={svg.height} />
      <Text>
        <Text weight="semibold">{d.valor}</Text>
        <Text dimColor>{` ${rotulo}`}</Text>
      </Text>
    </Box>
  )
}

type No = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

const eNo = (x: unknown): x is No => typeof x === 'object' && x !== null && 'type' in x

// Um anel da skins: um Svg, ou um Box com o Svg e o texto ao lado.
const temSvg = (x: unknown): boolean => eNo(x) && (x.type === 'Svg' || (x.type === 'Box' && (x.children ?? []).some(temSvg)))

// A fila onde a skins espalha os anéis: um Box space-evenly com pelo menos um anel.
const filaDosAneis = (no: unknown): No | undefined => {
  if (!eNo(no)) return undefined
  const filhos = no.children ?? []
  if (no.type === 'Box' && no.props?.justifyContent === 'space-evenly' && filhos.some(temSvg)) {
    return no
  }
  for (const f of filhos) {
    const achado = filaDosAneis(f)
    if (achado) return achado
  }
  return undefined
}

const MARCA = 'data-custo-sessao'

// A chave do anel: a skins da weTURN.ON muda para a fila dos anéis qualquer Box com uma chave `skins-band:`.
const CHAVE = 'skins-band:custo-sessao'

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

// Verde a meio-tom: lê-se em fundo claro e escuro.
const ARCO = '#2fb67a'

// Os Svg de uma árvore.
const svgsDe = (no: unknown): No[] =>
  !eNo(no) ? [] : no.type === 'Svg' ? [no] : (no.children ?? []).flatMap(svgsDe)

// A cor de destaque dos anéis da skins, para o tema bater certo: o arco (o segundo traço, o primeiro
// é o trilho) mais comum, porque um anel quase cheio passa a cor de aviso.
const arcoDe = (fila: No | undefined): string => {
  const arcos = svgsDe(fila).flatMap(s => [...String(s.props?.source ?? '').matchAll(/stroke="(#[0-9a-fA-F]{3,8})"/g)].slice(1, 2).map(m => m[1]!))
  const contas = new Map<string, number>()
  for (const a of arcos) contas.set(a, (contas.get(a) ?? 0) + 1)
  return [...contas].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ARCO
}

// Anel no mesmo desenho dos da skins: raio 9, traço 3. O trilho é cinzento a 25 %, que se vê nos dois temas.
const anel = (pct: number, arco: string) => {
  const r = 9
  const volta = 2 * Math.PI * r
  const cheio = (Math.min(Math.max(pct, 0), 100) / 100) * volta
  const source = `<svg xmlns="http://www.w3.org/2000/svg" ${MARCA}="1" width="26" height="30" viewBox="0 0 26 30"><circle cx="13" cy="15" r="${r}" fill="none" stroke="#8a8f8c" stroke-opacity=".35" stroke-width="3"/><circle cx="13" cy="15" r="${r}" fill="none" stroke="${arco}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${cheio.toFixed(2)} ${volta.toFixed(2)}" transform="rotate(-90 13 15)"/></svg>`
  return { source, width: 26, height: 30 }
}
