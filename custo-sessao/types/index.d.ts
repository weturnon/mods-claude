export type Custo = {
  /** Dólares de API (tabela pública) gastos por esta sessão. */
  usd: number
  /** Dólares de API que valem 1 ponto da % semanal; null enquanto a mod não aprendeu. */
  usdPorPonto: number | null
  /** Se já houve uma medição nesta sessão. */
  isMeasured: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'custo-sessao': { custo: Custo }
  }
}
