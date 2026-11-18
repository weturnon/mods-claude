import { expect, test } from 'claude-code/testing'

import { liftBandExtras } from './rows'
// weTURN.ON: os anéis da banda com a janela de 5h, e o texto como texto da app (segue o tema claro/escuro).
test('banda com 5h: anel em SVG, valor e rótulo em texto da app', async ($, on) => {
  const store = new Map<string, unknown>()
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => (store.set(e.key, e.value), { value: undefined }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 26000, percent: 13 }, rateLimits: [{ kind: 'five_hour', percentUsed: 2 }, { kind: 'seven_day', percentUsed: 4 }], cost: { usd: 1 } } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('config.list', () => ({ value: [{ key: 'theme', value: 'dark' }] }))
  on('env.get', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/' }))
  on('session.id', () => ({ value: 'x' }))
  on('clock.after', () => ({ value: { cancel() {} } }))
  on('clock.every', () => ({ value: { cancel() {} } }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('ui.log', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'Dark', stderr: '' } }))
  on('session.measure', (_: unknown, e: { changed: unknown }) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.measure({ context: { window: 200000, tokens: 26000, percent: 13 }, rateLimits: [{ kind: 'five_hour', percentUsed: 2 }, { kind: 'seven_day', percentUsed: 4 }], cost: { usd: 1 }, changed: ['context', 'rateLimits'] } as any)
  const m = await $.ui.mount({ plugin: 'skins', component: 'AbovePrompt', surface: 'desktop', props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as any)
  for (const [rotulo, pct] of [['context', '13%'], ['5h', '2%'], ['7d', '4%']]) {
    const t = await m.find({ type: 'Text', text: new RegExp(`${pct} ${rotulo}`) })
    expect(t?.text).toBe(`${pct} ${rotulo}`)
  }
  const s = await m.find({ type: 'Svg' })
  expect(String(s?.props.source)).not.toContain('<text')
  expect(String(s?.props.alt)).toContain('context 13%')
  await m.unmount()
})

// weTURN.ON: um mod ativado depois da skins (por dentro dela) entrega o anel num Box com a chave
// `skins-band:...`; a skins tira-o da árvore de baixo para o pôr na fila dos anéis.
test('liftBandExtras tira os anéis entregues por outros mods', () => {
  const anel = { type: 'Box', props: { key: 'skins-band:custo-sessao', flexDirection: 'row' }, children: [{ type: 'Text', children: ['0,42 €'] }] }
  const outro = { type: 'Text', children: ['fica'] }
  const arvore = { type: 'Box', props: { flexDirection: 'column' }, children: [{ type: 'engine', ref: 1 }, anel, outro] }
  const { tree, extras } = liftBandExtras(arvore)
  expect(extras).toEqual([anel])
  expect(tree).toEqual({ type: 'Box', props: { flexDirection: 'column' }, children: [{ type: 'engine', ref: 1 }, outro] })

  const sem = { type: 'Box', children: [outro] }
  expect(liftBandExtras(sem).tree).toBe(sem)
  expect(liftBandExtras(anel)).toEqual({ tree: '', extras: [anel] })
})
