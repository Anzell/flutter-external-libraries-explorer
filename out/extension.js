"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const yaml_1 = __importDefault(require("yaml"));
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
function activate(context) {
    const provider = new ExternalLibrariesTreeProvider();
    context.subscriptions.push(vscode.window.registerTreeDataProvider('flutterExternalLibrariesView', provider), vscode.commands.registerCommand('flutterExternalLibraries.refresh', () => provider.refresh()));
    const lockWatcher = vscode.workspace.createFileSystemWatcher('**/pubspec.lock');
    const packageConfigWatcher = vscode.workspace.createFileSystemWatcher('**/.dart_tool/package_config.json');
    const refreshFromWatcher = () => provider.refresh();
    context.subscriptions.push(lockWatcher, packageConfigWatcher, lockWatcher.onDidCreate(refreshFromWatcher), lockWatcher.onDidChange(refreshFromWatcher), lockWatcher.onDidDelete(refreshFromWatcher), packageConfigWatcher.onDidCreate(refreshFromWatcher), packageConfigWatcher.onDidChange(refreshFromWatcher), packageConfigWatcher.onDidDelete(refreshFromWatcher), vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()), vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('dart.sdkPath') || event.affectsConfiguration('dart.flutterSdkPath')) {
            provider.refresh();
        }
    }));
}
function deactivate() { }
class ExternalLibrariesTreeProvider {
    constructor() {
        this.onDidChangeTreeDataEmitter = new vscode.EventEmitter();
        this.workspaceModelCache = new Map();
        this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    }
    refresh() {
        this.workspaceModelCache.clear();
        this.onDidChangeTreeDataEmitter.fire();
    }
    getTreeItem(element) {
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
    async getChildren(element) {
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
            return workspaceFolders.map((workspaceFolder) => ({
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
                return model.dartPackages.map((packageItem) => ({
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
                return model.flutterPlugins.map((packageItem) => ({
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
    buildGroupNodes(workspaceFolder, model) {
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
    async getWorkspaceModel(workspaceFolder) {
        const cacheKey = workspaceFolder.uri.fsPath;
        const cached = this.workspaceModelCache.get(cacheKey);
        if (cached) {
            return cached;
        }
        const model = await loadWorkspaceModel(workspaceFolder);
        this.workspaceModelCache.set(cacheKey, model);
        return model;
    }
    async listDirectoryChildren(basePath) {
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
        const children = [];
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
                }
                else if (stats.isFile()) {
                    children.push({ type: 'file', fsPath: fullPath });
                }
            }
        }
        if (children.length === 0) {
            return [{ type: 'message', message: 'Sem arquivos neste diretório.' }];
        }
        return children;
    }
    getGroupLabel(group) {
        if (group === 'dartPackages') {
            return 'Dart Packages';
        }
        if (group === 'dartSdk') {
            return 'Dart SDK';
        }
        return 'Flutter Plugins';
    }
}
async function loadWorkspaceModel(workspaceFolder) {
    const workspacePath = workspaceFolder.uri.fsPath;
    const lockFilePath = path.join(workspacePath, 'pubspec.lock');
    const packageConfigPath = path.join(workspacePath, '.dart_tool', 'package_config.json');
    const lockPackages = await parsePubspecLock(lockFilePath);
    const packageConfig = await parsePackageConfig(packageConfigPath);
    const resolvedPackages = [];
    for (const lockPackage of lockPackages) {
        if (lockPackage.source === 'sdk') {
            continue;
        }
        const rootFromConfig = packageConfig.get(lockPackage.name);
        let rootPath = rootFromConfig ?? await resolvePackageRootFromLock(lockPackage, workspacePath);
        if (rootPath &&
            lockPackage.source === 'hosted' &&
            lockPackage.version.length > 0 &&
            !matchesHostedVersion(rootPath, lockPackage.name, lockPackage.version)) {
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
async function parsePubspecLock(lockFilePath) {
    try {
        if (!(await fileExists(lockFilePath))) {
            return [];
        }
        const lockText = await fs.readFile(lockFilePath, 'utf8');
        const parsed = yaml_1.default.parse(lockText);
        if (!isRecord(parsed)) {
            return [];
        }
        const packagesNode = parsed.packages;
        if (!isRecord(packagesNode)) {
            return [];
        }
        const lockPackages = [];
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
    }
    catch {
        return [];
    }
}
async function parsePackageConfig(packageConfigPath) {
    const packageRoots = new Map();
    try {
        if (!(await fileExists(packageConfigPath))) {
            return packageRoots;
        }
        const configText = await fs.readFile(packageConfigPath, 'utf8');
        const parsed = JSON.parse(configText);
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
    }
    catch {
        return packageRoots;
    }
    return packageRoots;
}
function resolveRootUri(configDir, rootUri) {
    if (rootUri.startsWith('file:')) {
        return vscode.Uri.parse(rootUri).fsPath;
    }
    const decoded = decodeURIComponent(rootUri);
    if (path.isAbsolute(decoded)) {
        return path.normalize(decoded);
    }
    return path.normalize(path.resolve(configDir, decoded));
}
async function resolvePackageRootFromLock(lockPackage, workspacePath) {
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
function extractHostedHost(description) {
    if (!isRecord(description)) {
        return undefined;
    }
    const urlText = readString(description.url);
    if (urlText.length === 0) {
        return undefined;
    }
    try {
        return new URL(urlText).host;
    }
    catch {
        return urlText.replace(/^https?:\/\//, '').replace(/\/$/, '');
    }
}
async function detectFlutterPlugin(packageRootPath) {
    try {
        const packagePubspecPath = path.join(packageRootPath, 'pubspec.yaml');
        if (!(await fileExists(packagePubspecPath))) {
            return false;
        }
        const pubspecText = await fs.readFile(packagePubspecPath, 'utf8');
        const parsed = yaml_1.default.parse(pubspecText);
        if (!isRecord(parsed)) {
            return false;
        }
        const flutterNode = parsed.flutter;
        if (!isRecord(flutterNode)) {
            return false;
        }
        return flutterNode.plugin !== undefined;
    }
    catch {
        return false;
    }
}
async function resolveDartSdkLibPath(workspaceFolder, packageConfig) {
    const dartConfig = vscode.workspace.getConfiguration('dart', workspaceFolder.uri);
    const configuredSdkPath = dartConfig.get('sdkPath');
    const fromConfiguredSdk = await toDartSdkRoot(configuredSdkPath);
    if (fromConfiguredSdk) {
        return path.join(fromConfiguredSdk, 'lib');
    }
    const configuredFlutterSdkPath = dartConfig.get('flutterSdkPath');
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
async function findDartExecutablePath() {
    const lookupTool = process.platform === 'win32' ? 'where' : 'which';
    try {
        const { stdout } = await execFileAsync(lookupTool, ['dart']);
        const firstLine = stdout
            .split(/\r?\n/)
            .map((item) => item.trim())
            .find((item) => item.length > 0);
        return firstLine;
    }
    catch {
        return undefined;
    }
}
async function toDartSdkRoot(candidatePath) {
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
async function validateDartSdkRoot(candidatePath) {
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
async function fileExists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    }
    catch {
        return false;
    }
}
async function directoryExists(targetPath) {
    const stats = await safeStat(targetPath);
    return stats?.isDirectory() ?? false;
}
async function safeStat(targetPath) {
    try {
        return await fs.stat(targetPath);
    }
    catch {
        return undefined;
    }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function readString(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return '';
}
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}
function matchesHostedVersion(packageRootPath, packageName, packageVersion) {
    return path.basename(packageRootPath) === `${packageName}-${packageVersion}`;
}
//# sourceMappingURL=extension.js.map