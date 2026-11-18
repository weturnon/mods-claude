import type { Skin } from '../skin'

// weTURN.ON: as cores do site (wto-website, src/layouts/Base.astro). Verde da marca como único destaque.
const skin: Skin = {
  name: 'weturnon',
  label: 'weTURN.ON',
  palette: {
    read: '#8ff0bf',
    write: '#ffd36b',
    run: '#3ad88a',
    search: '#7cc4ff',
    web: '#b8a1ff',
    mcp: '#cfd3d1',
    other: '#cfd3d1',
    user: '#3ad88a',
    fg: '#f2f2f2',
    muted: '#9a9e9b',
    surface: '#111312',
    zebra: '#171a18',
    ok: '#3ad88a',
    err: '#f87171',
    warn: '#ffd36b',
  },
  light: {
    read: '#137a49',
    write: '#a8741a',
    run: '#1a9e5c',
    search: '#2f6fb0',
    web: '#6a4fc4',
    mcp: '#444845',
    other: '#444845',
    user: '#1a9e5c',
    fg: '#0a0a0a',
    muted: '#5f6461',
    surface: '#ffffff',
    zebra: '#f1f5f3',
    ok: '#1a9e5c',
    err: '#c42b2b',
    warn: '#a8741a',
  },
  spinner: ['A pensar', 'A trabalhar', 'A preparar', 'A rever', 'A ligar'],
  done: ['Feito', 'Pronto', 'Ligado'],
}

export default skin
