import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import YAML from 'yaml';

const execFileAsync = promisify(execFile);

type GroupKind = 'dartPackages' | 'dartSdk' | 'flutterPlugins';

interface LockPackage {
  readonly name: string;
  readonly source: string;
  readonly version: string;
  readonly dependency: string;
  readonly description: unknown;
}

interface ResolvedPackage {
  readonly name: string;
  readonly source: string;
  readonly version: string;
  readonly dependency: string;
  readonly rootPath: string;
  readonly isFlutterPlugin: boolean;
}

interface WorkspaceModel {
  readonly dartPackages: readonly ResolvedPackage[];
  readonly flutterPlugins: readonly ResolvedPackage[];
  readonly dartSdkLibPath?: string;
}

interface WorkspaceNode {
  readonly type: 'workspace';
  readonly workspaceFolder: vscode.WorkspaceFolder;
}

interface GroupNode {
  readonly type: 'group';
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly group: GroupKind;
  readonly count: number;
}

interface PackageNode {
  readonly type: 'package';
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly group: GroupKind;
  readonly packageItem: ResolvedPackage;
}

interface DirectoryNode {
  readonly type: 'directory';
  readonly fsPath: string;
}

interface FileNode {
  readonly type: 'file';
  readonly fsPath: string;
}

interface MessageNode {
  readonly type: 'message';
  readonly message: string;
}

type ExternalNode = WorkspaceNode | GroupNode | PackageNode | DirectoryNode | FileNode | MessageNode;

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ExternalLibrariesTreeProvider();
  const searchManager = new SearchInDependenciesManager(provider);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('flutterExternalLibrariesView', provider),
    vscode.commands.registerCommand('flutterExternalLibraries.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('flutterExternalLibraries.enableSearchInDependencies', () => searchManager.enable()),
    vscode.commands.registerCommand('flutterExternalLibraries.disableSearchInDependencies', () => searchManager.disable()),
    vscode.commands.registerCommand('flutterExternalLibraries.openSearchInDependencies', () => searchManager.openSearch()),
    searchManager,
  );

  const lockWatcher = vscode.workspace.createFileSystemWatcher('**/pubspec.lock');
  const packageConfigWatcher = vscode.workspace.createFileSystemWatcher('**/.dart_tool/package_config.json');

  const refreshFromWatcher = (): void => provider.refresh();
  context.subscriptions.push(
    lockWatcher,
    packageConfigWatcher,
    lockWatcher.onDidCreate(refreshFromWatcher),
    lockWatcher.onDidChange(refreshFromWatcher),
    lockWatcher.onDidDelete(refreshFromWatcher),
    packageConfigWatcher.onDidCreate(refreshFromWatcher),
    packageConfigWatcher.onDidChange(refreshFromWatcher),
    packageConfigWatcher.onDidDelete(refreshFromWatcher),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
    vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
      if (event.affectsConfiguration('dart.sdkPath') || event.affectsConfiguration('dart.flutterSdkPath')) {
        provider.refresh();
      }
    }),
  );
}

export function deactivate(): void {}

class ExternalLibrariesTreeProvider implements vscode.TreeDataProvider<ExternalNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ExternalNode | undefined | null | void>();
  private readonly workspaceModelCache = new Map<string, WorkspaceModel>();
  readonly onDidChangeTreeData: vscode.Event<ExternalNode | undefined | null | void> = this.onDidChangeTreeDataEmitter.event;

  refresh(): void {
    this.workspaceModelCache.clear();
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: ExternalNode): vscode.TreeItem {
    if (element.type === 'workspace') {
      const item = new vscode.TreeItem(element.workspaceFolder.name, vscode.TreeItemCollapsibleState.Expanded);
      item.resourceUri = element.workspaceFolder.uri;
      item.contextValue = 'flutterExternalLibraries.workspace';
      return item;
    }

    if (element.type === 'group') {
      const item = new vscode.TreeItem(this.getGroupLabel(element.group), vscode.TreeItemCollapsibleState.Collapsed);
      item.description = element.group === 'dartSdk' ? undefined : `${element.count}`;
      item.contextValue = `flutterExternalLibraries.group.${element.group}`;
      return item;
    }

    if (element.type === 'package') {
      const label = element.packageItem.version.length > 0
        ? `${element.packageItem.name}-${element.packageItem.version}`
        : element.packageItem.name;
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = element.packageItem.source;
      item.tooltip = `${element.packageItem.rootPath}\nDependency: ${element.packageItem.dependency}`;
      item.resourceUri = vscode.Uri.file(element.packageItem.rootPath);
      item.contextValue = 'flutterExternalLibraries.package';
      return item;
    }

    if (element.type === 'directory') {
      const item = new vscode.TreeItem(path.basename(element.fsPath), vscode.TreeItemCollapsibleState.Collapsed);
      item.resourceUri = vscode.Uri.file(element.fsPath);
      item.contextValue = 'flutterExternalLibraries.directory';
      return item;
    }

    if (element.type === 'file') {
      const item = new vscode.TreeItem(path.basename(element.fsPath), vscode.TreeItemCollapsibleState.None);
      item.resourceUri = vscode.Uri.file(element.fsPath);
      item.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [vscode.Uri.file(element.fsPath)],
      };
      item.contextValue = 'flutterExternalLibraries.file';
      return item;
    }

    const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'flutterExternalLibraries.message';
    return item;
  }

  async getChildren(element?: ExternalNode): Promise<ExternalNode[]> {
    if (element === undefined) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        return [{ type: 'message', message: 'Abra um workspace com projeto Flutter/Dart.' }];
      }

      if (workspaceFolders.length === 1) {
        const workspaceFolder = workspaceFolders[0];
        if (!workspaceFolder) {
          return [{ type: 'message', message: 'Workspace inválido.' }];
        }
        const model = await this.getWorkspaceModel(workspaceFolder);
        return this.buildGroupNodes(workspaceFolder, model);
      }

      return workspaceFolders.map<WorkspaceNode>((workspaceFolder) => ({
        type: 'workspace',
        workspaceFolder,
      }));
    }

    if (element.type === 'workspace') {
      const model = await this.getWorkspaceModel(element.workspaceFolder);
      return this.buildGroupNodes(element.workspaceFolder, model);
    }

    if (element.type === 'group') {
      const model = await this.getWorkspaceModel(element.workspaceFolder);
      if (element.group === 'dartPackages') {
        if (model.dartPackages.length === 0) {
          return [{ type: 'message', message: 'Nenhum pacote Dart encontrado no pubspec.lock.' }];
        }
        return model.dartPackages.map<PackageNode>((packageItem) => ({
          type: 'package',
          workspaceFolder: element.workspaceFolder,
          group: element.group,
          packageItem,
        }));
      }

      if (element.group === 'flutterPlugins') {
        if (model.flutterPlugins.length === 0) {
          return [{ type: 'message', message: 'Nenhum plugin Flutter detectado nas dependências.' }];
        }
        return model.flutterPlugins.map<PackageNode>((packageItem) => ({
          type: 'package',
          workspaceFolder: element.workspaceFolder,
          group: element.group,
          packageItem,
        }));
      }

      if (!model.dartSdkLibPath) {
        return [{ type: 'message', message: 'Dart SDK não encontrado. Configure dart.sdkPath ou dart.flutterSdkPath.' }];
      }

      return this.listDirectoryChildren(model.dartSdkLibPath);
    }

    if (element.type === 'package') {
      return this.listDirectoryChildren(element.packageItem.rootPath);
    }

    if (element.type === 'directory') {
      return this.listDirectoryChildren(element.fsPath);
    }

    return [];
  }

  private buildGroupNodes(workspaceFolder: vscode.WorkspaceFolder, model: WorkspaceModel): GroupNode[] {
    return [
      {
        type: 'group',
        workspaceFolder,
        group: 'dartPackages',
        count: model.dartPackages.length,
      },
      {
        type: 'group',
        workspaceFolder,
        group: 'dartSdk',
        count: model.dartSdkLibPath ? 1 : 0,
      },
      {
        type: 'group',
        workspaceFolder,
        group: 'flutterPlugins',
        count: model.flutterPlugins.length,
      },
    ];
  }

  async getAllDependencyPaths(): Promise<string[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const allPaths: string[] = [];

    for (const folder of workspaceFolders) {
      const model = await this.getWorkspaceModel(folder);

      for (const pkg of [...model.dartPackages, ...model.flutterPlugins]) {
        allPaths.push(pkg.rootPath);
      }

      if (model.dartSdkLibPath) {
        allPaths.push(model.dartSdkLibPath);
      }
    }

    return [...new Set(allPaths)];
  }

  private async getWorkspaceModel(workspaceFolder: vscode.WorkspaceFolder): Promise<WorkspaceModel> {
    const cacheKey = workspaceFolder.uri.fsPath;
    const cached = this.workspaceModelCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const model = await loadWorkspaceModel(workspaceFolder);
    this.workspaceModelCache.set(cacheKey, model);
    return model;
  }

  private async listDirectoryChildren(basePath: string): Promise<ExternalNode[]> {
    if (!(await directoryExists(basePath))) {
      return [{ type: 'message', message: `Diretório inexistente: ${basePath}` }];
    }

    const entries = await fs.readdir(basePath, { withFileTypes: true });
    const sortedEntries = entries.slice().sort((a, b) => {
      const aDirectory = a.isDirectory();
      const bDirectory = b.isDirectory();
      if (aDirectory && !bDirectory) {
        return -1;
      }
      if (!aDirectory && bDirectory) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });

    const children: ExternalNode[] = [];

    for (const entry of sortedEntries) {
      const fullPath = path.join(basePath, entry.name);
      if (entry.isDirectory()) {
        children.push({ type: 'directory', fsPath: fullPath });
        continue;
      }

      if (entry.isFile()) {
        children.push({ type: 'file', fsPath: fullPath });
        continue;
      }

      if (entry.isSymbolicLink()) {
        const stats = await safeStat(fullPath);
        if (!stats) {
          continue;
        }
        if (stats.isDirectory()) {
          children.push({ type: 'directory', fsPath: fullPath });
        } else if (stats.isFile()) {
          children.push({ type: 'file', fsPath: fullPath });
        }
      }
    }

    if (children.length === 0) {
      return [{ type: 'message', message: 'Sem arquivos neste diretório.' }];
    }

    return children;
  }

  private getGroupLabel(group: GroupKind): string {
    if (group === 'dartPackages') {
      return 'Dart Packages';
    }

    if (group === 'dartSdk') {
      return 'Dart SDK';
    }

    return 'Flutter Plugins';
  }
}

class SearchInDependenciesManager implements vscode.Disposable {
  private static readonly configKey = 'flutterExternalLibraries.searchInDependencies';
  private static readonly contextKey = 'flutterExternalLibraries.searchInDependenciesEnabled';

  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly treeProvider: ExternalLibrariesTreeProvider) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.syncState();
    this.statusBarItem.show();

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
        if (event.affectsConfiguration(SearchInDependenciesManager.configKey)) {
          this.syncState();
        }
      }),
    );
  }

  private get isEnabled(): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(SearchInDependenciesManager.configKey, false);
  }

  enable(): void {
    void vscode.workspace.getConfiguration().update(
      SearchInDependenciesManager.configKey,
      true,
      vscode.ConfigurationTarget.Global,
    );
  }

  disable(): void {
    void vscode.workspace.getConfiguration().update(
      SearchInDependenciesManager.configKey,
      false,
      vscode.ConfigurationTarget.Global,
    ).then(() => {
      void vscode.commands.executeCommand('workbench.action.findInFiles', {
        filesToInclude: '',
        triggerSearch: false,
        showIncludesExcludes: true,
      });
    });
  }

  async openSearch(): Promise<void> {
    const depPaths = await this.treeProvider.getAllDependencyPaths();
    const workspacePaths = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
    const allPaths = [...workspacePaths, ...depPaths];

    if (depPaths.length === 0) {
      await vscode.commands.executeCommand('workbench.action.findInFiles');
      void vscode.window.showInformationMessage(
        'Nenhuma dependência Flutter encontrada. Execute flutter pub get no projeto.',
      );
      return;
    }

    await vscode.commands.executeCommand('workbench.action.findInFiles', {
      filesToInclude: allPaths.join(','),
      triggerSearch: false,
      showIncludesExcludes: true,
    });
  }

  private syncState(): void {
    const enabled = this.isEnabled;
    void vscode.commands.executeCommand('setContext', SearchInDependenciesManager.contextKey, enabled);
    this.updateStatusBar(enabled);
  }

  private updateStatusBar(enabled: boolean): void {
    if (enabled) {
      this.statusBarItem.text = '$(zoom-out) Busca: Workspace + Deps';
      this.statusBarItem.tooltip = 'Busca inclui dependências Flutter/Dart. Clique para buscar somente no workspace.';
      this.statusBarItem.command = 'flutterExternalLibraries.disableSearchInDependencies';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.statusBarItem.text = '$(zoom-in) Busca: Workspace';
      this.statusBarItem.tooltip = 'Busca somente no workspace. Clique para incluir dependências Flutter/Dart.';
      this.statusBarItem.command = 'flutterExternalLibraries.enableSearchInDependencies';
      this.statusBarItem.backgroundColor = undefined;
    }
  }

  dispose(): void {
    this.statusBarItem.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

async function loadWorkspaceModel(workspaceFolder: vscode.WorkspaceFolder): Promise<WorkspaceModel> {
  const workspacePath = workspaceFolder.uri.fsPath;
  const lockFilePath = path.join(workspacePath, 'pubspec.lock');
  const packageConfigPath = path.join(workspacePath, '.dart_tool', 'package_config.json');

  const lockPackages = await parsePubspecLock(lockFilePath);
  const packageConfig = await parsePackageConfig(packageConfigPath);

  const resolvedPackages: ResolvedPackage[] = [];

  for (const lockPackage of lockPackages) {
    if (lockPackage.source === 'sdk') {
      continue;
    }

    const rootFromConfig = packageConfig.get(lockPackage.name);
    let rootPath = rootFromConfig ?? await resolvePackageRootFromLock(lockPackage, workspacePath);

    if (
      rootPath &&
      lockPackage.source === 'hosted' &&
      lockPackage.version.length > 0 &&
      !matchesHostedVersion(rootPath, lockPackage.name, lockPackage.version)
    ) {
      const lockResolvedPath = await resolvePackageRootFromLock(lockPackage, workspacePath);
      rootPath = lockResolvedPath ?? rootPath;
    }

    if (!rootPath || !(await directoryExists(rootPath))) {
      continue;
    }

    const isFlutterPlugin = await detectFlutterPlugin(rootPath);
    resolvedPackages.push({
      name: lockPackage.name,
      source: lockPackage.source,
      version: lockPackage.version,
      dependency: lockPackage.dependency,
      rootPath,
      isFlutterPlugin,
    });
  }

  const dartPackages = resolvedPackages
    .filter((item) => !item.isFlutterPlugin)
    .sort((a, b) => a.name.localeCompare(b.name));

  const flutterPlugins = resolvedPackages
    .filter((item) => item.isFlutterPlugin)
    .sort((a, b) => a.name.localeCompare(b.name));

  const dartSdkLibPath = await resolveDartSdkLibPath(workspaceFolder, packageConfig);

  return {
    dartPackages,
    flutterPlugins,
    dartSdkLibPath,
  };
}

async function parsePubspecLock(lockFilePath: string): Promise<LockPackage[]> {
  try {
    if (!(await fileExists(lockFilePath))) {
      return [];
    }

    const lockText = await fs.readFile(lockFilePath, 'utf8');
    const parsed = YAML.parse(lockText);

    if (!isRecord(parsed)) {
      return [];
    }

    const packagesNode = parsed.packages;
    if (!isRecord(packagesNode)) {
      return [];
    }

    const lockPackages: LockPackage[] = [];

    for (const [name, packageData] of Object.entries(packagesNode)) {
      if (!isRecord(packageData)) {
        continue;
      }

      lockPackages.push({
        name,
        source: readString(packageData.source),
        version: readString(packageData.version),
        dependency: readString(packageData.dependency),
        description: packageData.description,
      });
    }

    return lockPackages;
  } catch {
    return [];
  }
}

async function parsePackageConfig(packageConfigPath: string): Promise<Map<string, string>> {
  const packageRoots = new Map<string, string>();

  try {
    if (!(await fileExists(packageConfigPath))) {
      return packageRoots;
    }

    const configText = await fs.readFile(packageConfigPath, 'utf8');
    const parsed = JSON.parse(configText) as unknown;

    if (!isRecord(parsed)) {
      return packageRoots;
    }

    const packages = parsed.packages;
    if (!Array.isArray(packages)) {
      return packageRoots;
    }

    const configDir = path.dirname(packageConfigPath);

    for (const packageItem of packages) {
      if (!isRecord(packageItem)) {
        continue;
      }

      const name = readString(packageItem.name);
      const rootUri = readString(packageItem.rootUri);

      if (name.length === 0 || rootUri.length === 0) {
        continue;
      }

      const rootPath = resolveRootUri(configDir, rootUri);
      packageRoots.set(name, rootPath);
    }
  } catch {
    return packageRoots;
  }

  return packageRoots;
}

function resolveRootUri(configDir: string, rootUri: string): string {
  if (rootUri.startsWith('file:')) {
    return vscode.Uri.parse(rootUri).fsPath;
  }

  const decoded = decodeURIComponent(rootUri);
  if (path.isAbsolute(decoded)) {
    return path.normalize(decoded);
  }

  return path.normalize(path.resolve(configDir, decoded));
}

async function resolvePackageRootFromLock(lockPackage: LockPackage, workspacePath: string): Promise<string | undefined> {
  if (lockPackage.source === 'path') {
    if (isRecord(lockPackage.description)) {
      const relativePath = readString(lockPackage.description.path);
      if (relativePath.length > 0) {
        const candidate = path.isAbsolute(relativePath)
          ? relativePath
          : path.resolve(workspacePath, relativePath);
        if (await directoryExists(candidate)) {
          return candidate;
        }
      }
    }

    return undefined;
  }

  if (lockPackage.source !== 'hosted' || lockPackage.version.length === 0) {
    return undefined;
  }

  const hostedHost = extractHostedHost(lockPackage.description);
  const hostCandidates = uniqueStrings([hostedHost, 'pub.dev', 'pub.flutter-io.cn']);
  const cacheCandidates = uniqueStrings([
    process.env.PUB_CACHE,
    path.join(os.homedir(), '.pub-cache'),
    path.join(workspacePath, '.pub-cache'),
    process.platform === 'win32' && process.env.APPDATA
      ? path.join(process.env.APPDATA, 'Pub', 'Cache')
      : undefined,
  ]);

  for (const cachePath of cacheCandidates) {
    for (const host of hostCandidates) {
      const candidate = path.join(cachePath, 'hosted', host, `${lockPackage.name}-${lockPackage.version}`);
      if (await directoryExists(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function extractHostedHost(description: unknown): string | undefined {
  if (!isRecord(description)) {
    return undefined;
  }

  const urlText = readString(description.url);
  if (urlText.length === 0) {
    return undefined;
  }

  try {
    return new URL(urlText).host;
  } catch {
    return urlText.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
}

async function detectFlutterPlugin(packageRootPath: string): Promise<boolean> {
  try {
    const packagePubspecPath = path.join(packageRootPath, 'pubspec.yaml');
    if (!(await fileExists(packagePubspecPath))) {
      return false;
    }

    const pubspecText = await fs.readFile(packagePubspecPath, 'utf8');
    const parsed = YAML.parse(pubspecText);

    if (!isRecord(parsed)) {
      return false;
    }

    const flutterNode = parsed.flutter;
    if (!isRecord(flutterNode)) {
      return false;
    }

    return flutterNode.plugin !== undefined;
  } catch {
    return false;
  }
}

async function resolveDartSdkLibPath(
  workspaceFolder: vscode.WorkspaceFolder,
  packageConfig: ReadonlyMap<string, string>,
): Promise<string | undefined> {
  const dartConfig = vscode.workspace.getConfiguration('dart', workspaceFolder.uri);

  const configuredSdkPath = dartConfig.get<string>('sdkPath');
  const fromConfiguredSdk = await toDartSdkRoot(configuredSdkPath);
  if (fromConfiguredSdk) {
    return path.join(fromConfiguredSdk, 'lib');
  }

  const configuredFlutterSdkPath = dartConfig.get<string>('flutterSdkPath');
  if (configuredFlutterSdkPath && configuredFlutterSdkPath.length > 0) {
    const fromFlutterSettings = await toDartSdkRoot(path.join(configuredFlutterSdkPath, 'bin', 'cache', 'dart-sdk'));
    if (fromFlutterSettings) {
      return path.join(fromFlutterSettings, 'lib');
    }
  }

  const fromEnvDartSdk = await toDartSdkRoot(process.env.DART_SDK);
  if (fromEnvDartSdk) {
    return path.join(fromEnvDartSdk, 'lib');
  }

  if (process.env.FLUTTER_ROOT) {
    const fromEnvFlutter = await toDartSdkRoot(path.join(process.env.FLUTTER_ROOT, 'bin', 'cache', 'dart-sdk'));
    if (fromEnvFlutter) {
      return path.join(fromEnvFlutter, 'lib');
    }
  }

  const flutterPackagePath = packageConfig.get('flutter');
  if (flutterPackagePath) {
    const flutterSdkPath = path.resolve(flutterPackagePath, '..', '..');
    const fromFlutterPackage = await toDartSdkRoot(path.join(flutterSdkPath, 'bin', 'cache', 'dart-sdk'));
    if (fromFlutterPackage) {
      return path.join(fromFlutterPackage, 'lib');
    }
  }

  const executablePath = await findDartExecutablePath();
  if (executablePath) {
    const fromExecutable = await toDartSdkRoot(executablePath);
    if (fromExecutable) {
      return path.join(fromExecutable, 'lib');
    }
  }

  return undefined;
}

async function findDartExecutablePath(): Promise<string | undefined> {
  const lookupTool = process.platform === 'win32' ? 'where' : 'which';

  try {
    const { stdout } = await execFileAsync(lookupTool, ['dart']);
    const firstLine = stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.length > 0);

    return firstLine;
  } catch {
    return undefined;
  }
}

async function toDartSdkRoot(candidatePath: string | undefined): Promise<string | undefined> {
  if (!candidatePath || candidatePath.length === 0) {
    return undefined;
  }

  const normalizedCandidate = path.normalize(candidatePath);

  const sdkRootCandidate = await validateDartSdkRoot(normalizedCandidate);
  if (sdkRootCandidate) {
    return sdkRootCandidate;
  }

  const dartExecutableNames = new Set(['dart', 'dart.exe']);
  const baseName = path.basename(normalizedCandidate).toLowerCase();
  if (dartExecutableNames.has(baseName)) {
    const fromExecutablePath = path.dirname(path.dirname(normalizedCandidate));
    const validatedFromExecutablePath = await validateDartSdkRoot(fromExecutablePath);
    if (validatedFromExecutablePath) {
      return validatedFromExecutablePath;
    }
  }

  const fromBinDirectory = await validateDartSdkRoot(path.join(normalizedCandidate, '..'));
  if (fromBinDirectory) {
    return fromBinDirectory;
  }

  return undefined;
}

async function validateDartSdkRoot(candidatePath: string): Promise<string | undefined> {
  const normalizedCandidate = path.normalize(candidatePath);
  const libPath = path.join(normalizedCandidate, 'lib');
  const binDartPath = path.join(normalizedCandidate, 'bin', 'dart');
  const binDartExePath = path.join(normalizedCandidate, 'bin', 'dart.exe');

  const libExists = await directoryExists(libPath);
  if (!libExists) {
    return undefined;
  }

  const hasBinary = await fileExists(binDartPath) || await fileExists(binDartExePath);
  if (!hasBinary) {
    return undefined;
  }

  return normalizedCandidate;
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(targetPath: string): Promise<boolean> {
  const stats = await safeStat(targetPath);
  return stats?.isDirectory() ?? false;
}

async function safeStat(targetPath: string): Promise<Awaited<ReturnType<typeof fs.stat>> | undefined> {
  try {
    return await fs.stat(targetPath);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function matchesHostedVersion(packageRootPath: string, packageName: string, packageVersion: string): boolean {
  return path.basename(packageRootPath) === `${packageName}-${packageVersion}`;
}
