# Flutter External Libraries Explorer

Extensão VS Code/Cursor para navegação e busca no código-fonte de bibliotecas externas em projetos Flutter/Dart, usando a versão exata resolvida no `pubspec.lock`.

## O que a extensão faz

- Adiciona a view **External Libraries (Flutter)** no painel Explorer.
- Organiza as dependências em três grupos:
  - `Dart Packages` — pacotes Dart do projeto
  - `Flutter Plugins` — plugins Flutter detectados automaticamente
  - `Dart SDK` — biblioteca padrão do Dart SDK
- Resolve pacotes a partir de:
  1. `.dart_tool/package_config.json` (fonte principal)
  2. `pubspec.lock` + cache do Pub (`.pub-cache`) como fallback
- Exibe cada pacote com rótulo `nome-versão`, garantindo a versão exata do `pubspec.lock`.
- Permite navegar e abrir todo o código-fonte dos pacotes e do SDK diretamente na árvore.
- **Busca nas dependências**: permite incluir o código-fonte das dependências no search nativo do IDE.

## Busca nas dependências

Por padrão, o `Ctrl+Shift+F` (`Cmd+Shift+F` no Mac) busca apenas nos arquivos do workspace. Com essa extensão, você pode expandir o escopo para incluir o código-fonte de todas as dependências resolvidas.

### Como ativar

Na view **External Libraries (Flutter)**, clique no ícone `$(zoom-in)` na barra de título para ativar o modo **Workspace + Deps**.

Quando ativado:
- O ícone muda para `$(zoom-out)` (indicando que o modo está ativo)
- A barra de status exibe **Busca: Workspace + Deps**
- `Ctrl+Shift+F` / `Cmd+Shift+F` passa a abrir o search com o campo *files to include* preenchido automaticamente com o workspace e todos os caminhos das dependências resolvidas
- Um botão `$(search)` adicional aparece na barra de título para abrir a busca diretamente

### Como desativar

Clique no ícone `$(zoom-out)` na barra de título ou no item da barra de status. O campo *files to include* é limpo automaticamente e o search volta ao comportamento padrão.

### Configuração

A preferência é salva globalmente. Você também pode alterá-la em:

**Settings** → pesquise por `Flutter External Libraries` → `Search In Dependencies`

```json
"flutterExternalLibraries.searchInDependencies": false
```

## Pré-requisitos

- VS Code ou Cursor 1.85+
- Projeto Flutter/Dart com `pubspec.lock` e `.dart_tool/package_config.json` gerados (`flutter pub get` ou `dart pub get`)

## Instalação

1. Abra a aba de extensões no VS Code/Cursor.
2. Pesquise por `Flutter External Libraries Explorer`.
3. Clique em **Install**.

Depois, abra seu projeto Flutter e use a view **External Libraries (Flutter)** no Explorer.

## Comandos disponíveis

| Comando | Descrição |
|---|---|
| `Flutter External Libraries: Atualizar` | Recarrega a árvore de dependências |
| `Flutter External Libraries: Incluir Dependências na Busca` | Ativa o modo Workspace + Deps |
| `Flutter External Libraries: Buscar Somente no Workspace` | Desativa o modo Workspace + Deps |
| `Flutter External Libraries: Abrir Busca nas Dependências` | Abre o search com as dependências incluídas |
