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

Os mods de terceiros estão fixados no commit revisto. Não se puxam versões novas dos autores sem ler o código.
