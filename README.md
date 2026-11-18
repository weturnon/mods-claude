# Mods do Claude Code da weTURN.ON

Três mods para o Claude Code:

1. **savvy-progress**: painel dos agentes (subagentes a correr, acabados e planeados, com modelo, contexto, custo e tempo).
2. **skins**: anéis do contexto e da semana em cima do prompt, temas e cartões no transcript.
3. **custo-sessao**: quanto a sessão já custou e a % da semana gasta.

## Instalar

No terminal (precisa de acesso a este repositório no GitHub e de uma versão recente do Claude Code):

```bash
claude plugin marketplace add weturnon/mods-claude
claude plugin install savvy-progress@mods-weturnon
claude plugin install skins@mods-weturnon
claude plugin install custo-sessao@mods-weturnon
```

Depois, reiniciar o Claude Code (ou a app).

O custo-sessao assume o plano Team (25 por mês). Quem tiver outro plano muda o "Preço mensal do plano" nas opções do plugin.

## Atualizar

Quando sai uma versão nova (por exemplo, custo-sessao 0.4.0 e skins 0.5.16-wto.2, que corrigem a barra nas contas com limite de 5h e o tema claro):

```bash
claude plugin marketplace update mods-weturnon
```

```bash
claude plugin update skins@mods-weturnon
```

```bash
claude plugin update custo-sessao@mods-weturnon
```

Depois, reiniciar o Claude Code (ou a app). Se o `update` disser que já está na última versão, desinstalar e voltar a instalar o mod.

O custo-sessao e o skins têm de ser atualizados juntos: o anel do custo entra na linha dos anéis do skins seja qual for a ordem em que foram instalados, mas só com as duas versões novas.

Os mods de terceiros estão fixados no commit revisto. Não se puxam versões novas dos autores sem ler o código.
