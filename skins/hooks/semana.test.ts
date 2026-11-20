import { expect, test } from 'claude-code/testing'

import { metersOf, weekLeftOf } from './svg-usage'

const H = 3600_000

test('o limite semanal mostra o tempo que falta para renovar', async () => {
  expect(weekLeftOf(3 * 24 * H + 20 * H)).toBe('faltam 3 dias')
  expect(weekLeftOf(24 * H + 5 * H)).toBe('falta 1 dia')
  expect(weekLeftOf(5 * H + 30 * 60_000)).toBe('faltam 5 h')
  expect(weekLeftOf(12 * 60_000)).toBe('faltam 12 min')
  expect(weekLeftOf(0)).toBe('a renovar')
  const usage = { context: 61, limits: [{ label: '5h', percent: 10, resetsAt: 2 * H }, { label: '7d', percent: 28, resetsAt: 50 * H }] }
  expect(metersOf(usage, {}, 0).map(m => m.label)).toEqual(['context', '5h', 'faltam 2 dias'])
  expect(metersOf(usage).map(m => m.label)).toEqual(['context', '5h', '7d'])
})
