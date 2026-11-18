import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'custo-sessao',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const medir = (usd: number, percentUsed: number, extra: Record<string, unknown> = {}, cincoHoras?: number) => (app.total = usd, {
  context: { window: 200000 },
  rateLimits: [
    ...(cincoHoras === undefined ? [] : [{ kind: 'five_hour', percentUsed: cincoHoras }]),
    { kind: 'seven_day', percentUsed, ...extra },
  ],
  cost: { usd },
  changed: ['cost', 'rateLimits'],
})

const app = { total: 0 }

// O texto ao lado do anel (o valor e o rótulo), que é texto da app e não do SVG.
const textoDe = async (m: any) => String((await m.find({ type: 'Text', text: /US\$|€/ }))?.text ?? '')

const preparar = async ($: any, on: any, store: Map<string, unknown>, aneis: boolean, inicial = 0) => {
  app.total = inicial
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'abc' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [], cost: { usd: app.total } } }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => (store.set(e.key, e.value), { value: undefined }))
  on('session.measure', (_: unknown, e: { changed: unknown }) => ({ changed: e.changed }))
  on('ui.render', ($: any, e: any) => {
    const { Box, Svg } = $.ui.resolve(e)
    if (!aneis || e.surface === 'terminal') return <Box />
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-evenly">
          <Svg source='<svg><circle stroke="#111111"/><circle stroke="#222222"/><tspan style="fill:#333333"/><tspan style="fill:#444444"/></svg>' alt="context 18%" />
        </Box>
      </Box>
    )
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
}

test('aprende quantos dólares vale um ponto e converte para o preço do plano', { options: { precoMensal: 200, moeda: 'USD' } }, async ($, on) => {
  const store = new Map<string, unknown>()
  await preparar($, on, store, true)

  await $.session.measure(medir(1, 50)) // começa a contar
  const antes = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const primeiro = await textoDe(antes)
  expect(primeiro).toContain('a calibrar')
  expect(primeiro).toContain('1,00')
  expect(String((await antes.find({ type: 'Svg' }))?.props.alt)).toContain('a aprender')
  await antes.unmount()

  await $.session.measure(medir(3, 51)) // primeira subida: ponto apanhado a meio, ignorada
  await $.session.measure(medir(7, 51))
  await $.session.measure(medir(9, 53)) // 6 $ em 2 pontos = 3 $ por ponto

  // Linha própria (sem anéis da skins onde entrar).
  // 9 $ ÷ 3 = 3 pontos; 200 $ ÷ 4 ÷ 100 = 0,50 $ por ponto → 1,50 $ do plano; 9,00 $ de API
  // A entrada na linha da skins (e.plugin === 'skins') só se vê numa sessão: o kit não ergue a linha de outro mod.
  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const fonte = await textoDe(desk)
  expect(fonte).toMatch(/1,50\sUS\$/)
  expect(fonte).toMatch(/9,00\sUS\$ API/)
  expect(fonte).toContain('3% semana')
  const svg = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('data-custo-sessao')
  // O SVG só tem o anel: nenhum texto com cor fixa que desapareça no tema claro.
  expect(svg).not.toContain('<text')
  await desk.unmount()

  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const texto = (await term.find({ type: 'Text', text: /custou/ }))?.text
  expect(texto).toContain('1,50')
  expect(texto).toContain('9,00')
  await term.unmount()
})

test('a semana a recomeçar e o processo a reabrir não estragam a conta', async ($, on) => {
  const store = new Map<string, unknown>()
  store.set('cal', { pendente: 0, semana: 40, isPrimeira: false, amostras: [2] })
  store.set('calVersao', 2)
  await preparar($, on, store, false)

  await $.session.measure(medir(4, 41)) // 4 $ → amostra 4/1
  await $.session.measure(medir(1, 0.5)) // processo novo (total desceu) e semana recomeçou
  // sessão: 4 + 1 = 5 $; mediana de [2, 4] = 3 $ por ponto → 1,67 pontos; 25 € → 0,0625 €/ponto → 0,10 €
  expect(store.get('s:abc')).toEqual({ usd: 5, ultimoTotal: 1 })
  const cal = store.get('cal') as any
  expect(cal.amostras).toEqual([2, 4])
  expect(cal.semana).toBe(0.5)

  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const fonte = await textoDe(desk)
  expect(fonte).toContain('0,10')
  expect(fonte).toContain('1,7% semana')
  await desk.unmount()
})

test('recarregar não conta a dobrar e o gasto antes da mod não entra na calibração', async ($, on) => {
  const store = new Map<string, unknown>()
  store.set('calVersao', 2)
  await preparar($, on, store, false, 10) // sessão já tinha gasto 10 $ quando a mod chegou
  expect(store.get('s:abc')).toEqual({ usd: 10, ultimoTotal: 10 })

  await $.session.measure(medir(12, 50))
  await $.session.measure(medir(13, 51))
  expect((store.get('cal') as any).pendente).toBe(0)
  await $.session.measure(medir(15, 51))
  expect((store.get('cal') as any).pendente).toBe(2) // só o gasto depois da mod
  expect((store.get('s:abc') as any).usd).toBe(15)

  // /reload-plugins: o mesmo processo, a app continua nos 15 $
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.measure(medir(16, 51))
  expect((store.get('s:abc') as any).usd).toBe(16)
})

test('a versão antiga da calibração é recomeçada uma vez', async ($, on) => {
  const store = new Map<string, unknown>()
  store.set('cal', { pendente: 17, semana: 51, isPrimeira: false, amostras: [] })
  await preparar($, on, store, false)
  expect(store.get('cal')).toEqual({ pendente: 0, semana: 51, isPrimeira: true, amostras: [] })
  expect(store.get('calVersao')).toBe(2)
})


test('com a janela de 5h ao lado, a semana calibra na mesma', async ($, on) => {
  const store = new Map<string, unknown>()
  store.set('calVersao', 2)
  await preparar($, on, store, false)
  const reinicio = { resetsAt: '2026-11-20T10:00:00Z' }

  await $.session.measure(medir(1, 4, reinicio, 2)) // começa a contar
  await $.session.measure(medir(2, 5, reinicio, 30)) // primeira subida: ignorada
  await $.session.measure(medir(4, 5, reinicio, 70)) // a de 5h sobe à vontade: não conta
  await $.session.measure(medir(6, 6, reinicio, 2)) // a de 5h recomeçou: a semana não
  const cal = store.get('cal') as any
  expect(cal.amostras).toEqual([4])
  expect(cal.semana).toBe(6)

  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await textoDe(desk)).toContain('% semana')
  await desk.unmount()
})

test('uma leitura atrasada de outra sessão não recomeça a calibração', async ($, on) => {
  const store = new Map<string, unknown>()
  store.set('calVersao', 2)
  await preparar($, on, store, false)
  const reinicio = { resetsAt: '2026-11-20T10:00:00Z' }

  await $.session.measure(medir(1, 10, reinicio))
  await $.session.measure(medir(2, 11, reinicio)) // primeira subida: ignorada
  await $.session.measure(medir(3, 10, reinicio)) // outra sessão ainda vê 10 %
  await $.session.measure(medir(5, 12, reinicio)) // 3 $ desde os 11 %, num ponto
  expect((store.get('cal') as any).amostras).toEqual([3])

  // Sem resetsAt: uma descida pequena também é atraso, não semana nova.
  await $.session.measure(medir(6, 11))
  await $.session.measure(medir(8, 13)) // 3 $ em 1 ponto (de 12 para 13)
  expect((store.get('cal') as any).amostras).toEqual([3, 3])
})

test('semana nova pelo resetsAt, mesmo sem a % voltar a zero', async ($, on) => {
  const store = new Map<string, unknown>()
  store.set('calVersao', 2)
  store.set('cal', { pendente: 0, semana: 40, reinicio: '2026-11-13T10:00:00Z', isPrimeira: false, amostras: [2] })
  await preparar($, on, store, false)

  await $.session.measure(medir(1, 3, { resetsAt: '2026-11-20T10:00:00Z' }))
  const cal = store.get('cal') as any
  expect(cal).toMatchObject({ semana: 3, reinicio: '2026-11-20T10:00:00Z', isPrimeira: true, pendente: 0, amostras: [2] })
})

test('com os anéis da skins em Box (anel + texto), a linha própria sai quando o anel já lá está', async ($, on) => {
  const anelSkins = (n: string) => ({ type: 'Box', props: { flexDirection: 'row' }, children: [
    { type: 'Svg', props: { source: '<svg><circle stroke="#111111"/><circle stroke="#222222"/></svg>', alt: n, width: 26, height: 30 } },
    { type: 'Text', children: [n] },
  ] })
  const nosso = { type: 'Box', props: { flexDirection: 'row' }, children: [
    { type: 'Svg', props: { source: '<svg data-custo-sessao="1"></svg>', alt: 'custo', width: 26, height: 30 } },
  ] }
  const skins = { type: 'Box', props: { flexDirection: 'column' }, children: [
    { type: 'Box', props: { flexDirection: 'row', justifyContent: 'space-evenly' }, children: [anelSkins('13% context'), anelSkins('2% 5h'), anelSkins('4% 7d'), nosso] },
  ] }
  const propria = { type: 'Box', props: { flexDirection: 'column' }, children: [nosso] }
  let vistas: any[] = []
  on('ui.render', { component: 'AbovePromptList' }, (_: unknown, e: any) => ((vistas = e.props.rows), { type: 'Box', children: [] }))
  await preparar($, on, new Map<string, unknown>(), false)
  const m = await $.ui.mount({ ...BAND, component: 'AbovePromptList', surface: 'desktop', props: { ...BAND.props, rows: [{ plugin: 'skins', tree: skins }, { plugin: 'custo-sessao', tree: propria }] } } as any)
  expect(vistas.map(r => r.plugin)).toEqual(['skins'])
  await m.unmount()
})
