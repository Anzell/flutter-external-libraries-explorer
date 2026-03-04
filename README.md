# Flutter External Libraries Explorer

Extensão VS Code para navegação de bibliotecas externas em projetos Flutter/Dart, com foco em usar a versão exata resolvida no `pubspec.lock`.

## O que a extensão faz

- Adiciona a view `External Libraries (Flutter)` no painel Explorer.
- Mostra grupos:
  - `Dart Packages`
  - `Dart SDK`
  - `Flutter Plugins`
- Resolve pacotes a partir de:
  1. `.dart_tool/package_config.json` (fonte principal)
  2. `pubspec.lock` + cache do Pub (`.pub-cache`) como fallback
- Exibe pacotes com rótulo `nome-versão`, garantindo a versão do `pubspec.lock`.
- Permite abrir todo o código-fonte dos pacotes e SDK diretamente na árvore.

## Pré-requisitos

- VS Code 1.85+
- Projeto Flutter/Dart com `pubspec.lock` e `.dart_tool/package_config.json` gerados (`flutter pub get` ou `dart pub get`)

## Instalação (Marketplace)

1. Abra a aba de extensões no VS Code/Cursor.
2. Pesquise por `Flutter External Libraries Explorer`.
3. Clique em `Install`.

Depois, abra seu projeto Flutter e use a view `External Libraries (Flutter)` no Explorer.

## Comando da extensão

- `Flutter External Libraries: Refresh`
