// GizmoManager - loads and manages agent-built toolkit modules

import { homedir } from "node:os";
import { join } from "node:path";
import { watch, existsSync, mkdirSync, readdirSync } from "node:fs";
import { Project, type SourceFile } from "ts-morph";

// Bund home directory and gizmos subdirectory
const BUND_HOME = join(homedir(), ".bund");
const GIZMOS_DIR = join(BUND_HOME, "gizmos");

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [GIZMOS] ${msg}`);
}

/**
 * Parsed info about a gizmo's exported function
 */
interface GizmoFunction {
  name: string;
  signature: string;  // e.g., "addTask(title: string): TaskRowSchema"
  jsDoc?: string;     // JSDoc comment if present
}

/**
 * Parsed info about a gizmo's exported type
 */
interface GizmoType {
  name: string;
  declaration: string;  // Full type declaration
}

/**
 * Parsed gizmo metadata
 */
interface GizmoInfo {
  filename: string;      // Original filename (e.g., "task-manager.ts")
  propertyName: string;  // camelCase property name (e.g., "taskManager")
  description?: string;  // File-level JSDoc comment
  functions: GizmoFunction[];
  types: GizmoType[];
  module: Record<string, Function>;  // Loaded module exports
}

/**
 * Convert kebab-case or snake_case filename to camelCase
 */
function toCamelCase(filename: string): string {
  // Remove .ts extension
  const base = filename.replace(/\.ts$/, "");
  // Convert kebab-case or snake_case to camelCase
  return base.replace(/[-_]([a-z])/g, (_, char) => char.toUpperCase());
}

/**
 * Convert camelCase to PascalCase for interface names
 */
function toPascalCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export class GizmoManager {
  private gizmos: Map<string, GizmoInfo> = new Map();
  private project: Project;
  private watcher: ReturnType<typeof watch> | null = null;

  constructor() {
    this.project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: 2, // ES2015
        module: 1, // CommonJS
      },
    });
  }

  /**
   * Initialize the gizmo manager - ensure directory exists and load all gizmos
   */
  async initialize(): Promise<void> {
    log("Initializing GizmoManager...");

    // Ensure gizmos directory exists
    if (!existsSync(GIZMOS_DIR)) {
      log(`Creating gizmos directory: ${GIZMOS_DIR}`);
      mkdirSync(GIZMOS_DIR, { recursive: true });
    }

    // Load all existing gizmos
    await this.loadAllGizmos();
    log(`Initialized with ${this.gizmos.size} gizmo(s)`);
  }

  /**
   * Load all .ts files from the gizmos directory
   */
  private async loadAllGizmos(): Promise<void> {
    if (!existsSync(GIZMOS_DIR)) return;

    const files = readdirSync(GIZMOS_DIR).filter(f => f.endsWith(".ts"));
    log(`Found ${files.length} gizmo file(s)`);

    for (const filename of files) {
      await this.loadGizmo(filename);
    }
  }

  /**
   * Load or reload a single gizmo file
   */
  private async loadGizmo(filename: string): Promise<void> {
    const filePath = join(GIZMOS_DIR, filename);
    log(`Loading gizmo: ${filename}`);

    try {
      // Parse the TypeScript file to extract metadata
      const fileContent = await Bun.file(filePath).text();
      const sourceFile = this.project.createSourceFile(
        `gizmo_${Date.now()}.ts`,
        fileContent,
        { overwrite: true }
      );

      const gizmoInfo = this.parseGizmoFile(sourceFile, filename);
      sourceFile.delete();

      // Dynamically import the module with cache-busting
      const moduleUrl = `file://${filePath}?t=${Date.now()}`;
      const module = await import(moduleUrl);

      // Store the module exports
      gizmoInfo.module = {};
      for (const func of gizmoInfo.functions) {
        if (typeof module[func.name] === "function") {
          gizmoInfo.module[func.name] = module[func.name];
        }
      }

      this.gizmos.set(gizmoInfo.propertyName, gizmoInfo);
      log(`Loaded gizmo "${gizmoInfo.propertyName}" with ${gizmoInfo.functions.length} function(s)`);
    } catch (error) {
      log(`Failed to load gizmo ${filename}: ${error}`);
    }
  }

  /**
   * Parse a gizmo source file to extract metadata
   */
  private parseGizmoFile(sourceFile: SourceFile, filename: string): GizmoInfo {
    const propertyName = toCamelCase(filename);
    const functions: GizmoFunction[] = [];
    const types: GizmoType[] = [];

    // Extract file-level JSDoc (first JSDoc comment in file)
    let description: string | undefined;
    const firstStatement = sourceFile.getStatements()[0];
    if (firstStatement) {
      const leadingComments = firstStatement.getLeadingCommentRanges();
      for (const comment of leadingComments) {
        const text = comment.getText();
        if (text.startsWith("/**")) {
          // Extract description from JSDoc
          description = text
            .replace(/^\/\*\*\s*/, "")
            .replace(/\s*\*\/$/, "")
            .replace(/^\s*\*\s?/gm, "")
            .trim();
          break;
        }
      }
    }

    // Extract exported functions
    for (const func of sourceFile.getFunctions()) {
      if (!func.isExported()) continue;
      const name = func.getName();
      if (!name) continue;

      // Build signature
      const params = func.getParameters()
        .map(p => p.getText())
        .join(", ");
      const returnType = func.getReturnTypeNode()?.getText() || func.getReturnType().getText() || "unknown";
      const asyncKeyword = func.isAsync() ? "async " : "";

      // Clean up return type if it's too complex
      const cleanReturnType = returnType.length > 100 ? "unknown" : returnType;
      const signature = `${name}(${params}): ${cleanReturnType}`;

      // Extract JSDoc
      let jsDoc: string | undefined;
      const jsDocs = func.getJsDocs();
      if (jsDocs.length > 0) {
        jsDoc = jsDocs[0]?.getDescription()?.trim();
      }

      functions.push({ name, signature, jsDoc });
    }

    // Extract exported type aliases
    for (const typeAlias of sourceFile.getTypeAliases()) {
      if (!typeAlias.isExported()) continue;
      types.push({
        name: typeAlias.getName(),
        declaration: typeAlias.getText(),
      });
    }

    // Extract exported interfaces
    for (const iface of sourceFile.getInterfaces()) {
      if (!iface.isExported()) continue;
      types.push({
        name: iface.getName(),
        declaration: iface.getText(),
      });
    }

    return {
      filename,
      propertyName,
      description,
      functions,
      types,
      module: {},
    };
  }

  /**
   * Unload a gizmo when its file is removed
   */
  private unloadGizmo(filename: string): void {
    const propertyName = toCamelCase(filename);
    if (this.gizmos.has(propertyName)) {
      this.gizmos.delete(propertyName);
      log(`Unloaded gizmo: ${propertyName}`);
    }
  }

  /**
   * Start watching the gizmos directory for changes
   */
  startWatching(): void {
    if (this.watcher) return;

    if (!existsSync(GIZMOS_DIR)) {
      log("Gizmos directory doesn't exist, skipping watch");
      return;
    }

    log(`Watching gizmos directory: ${GIZMOS_DIR}`);
    this.watcher = watch(GIZMOS_DIR, async (eventType, filename) => {
      if (!filename || !filename.endsWith(".ts")) return;

      log(`File change detected: ${eventType} ${filename}`);

      const filePath = join(GIZMOS_DIR, filename);
      if (existsSync(filePath)) {
        // File added or changed - reload it
        await this.loadGizmo(filename);
      } else {
        // File removed - unload it
        this.unloadGizmo(filename);
      }
    });
  }

  /**
   * Stop watching the gizmos directory
   */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      log("Stopped watching gizmos directory");
    }
  }

  /**
   * Get a proxy object that provides access to all gizmo modules
   * Usage: gizmos.taskManager.addTask(...)
   */
  getGizmosProxy(): Record<string, Record<string, Function>> {
    const self = this;

    return new Proxy({} as Record<string, Record<string, Function>>, {
      get(_, prop: string) {
        const gizmo = self.gizmos.get(prop);
        if (!gizmo) {
          throw new Error(`Gizmo "${prop}" not found. Available: ${Array.from(self.gizmos.keys()).join(", ") || "(none)"}`);
        }
        return gizmo.module;
      },
      ownKeys() {
        return Array.from(self.gizmos.keys());
      },
      getOwnPropertyDescriptor(_, prop: string) {
        if (self.gizmos.has(prop)) {
          return { configurable: true, enumerable: true };
        }
        return undefined;
      },
    });
  }

  /**
   * Generate TypeScript declarations for all gizmos
   * This is injected into the materialized context
   */
  materializeTypes(): string {
    if (this.gizmos.size === 0) return "";

    const parts: string[] = [];

    // Collect all type declarations from gizmos
    const allTypes: string[] = [];
    for (const gizmo of this.gizmos.values()) {
      for (const type of gizmo.types) {
        allTypes.push(type.declaration);
      }
    }

    if (allTypes.length > 0) {
      parts.push(allTypes.join("\n\n"));
      parts.push("");
    }

    // Generate interface for each gizmo
    const gizmoInterfaces: string[] = [];
    const gizmoProperties: string[] = [];

    for (const gizmo of this.gizmos.values()) {
      const interfaceName = `Gizmo${toPascalCase(gizmo.propertyName)}`;

      // Build interface with function signatures
      const methodLines = gizmo.functions.map(func => {
        const jsDocComment = func.jsDoc ? `  /** ${func.jsDoc} */\n` : "";
        return `${jsDocComment}  ${func.signature};`;
      });

      const interfaceDecl = gizmo.description
        ? `/** ${gizmo.description} */\ninterface ${interfaceName} {\n${methodLines.join("\n")}\n}`
        : `interface ${interfaceName} {\n${methodLines.join("\n")}\n}`;

      gizmoInterfaces.push(interfaceDecl);

      // Build property for gizmos object
      const propComment = gizmo.description ? `  /** ${gizmo.description} */\n` : "";
      gizmoProperties.push(`${propComment}  ${gizmo.propertyName}: ${interfaceName};`);
    }

    parts.push(gizmoInterfaces.join("\n\n"));
    parts.push("");
    parts.push(`declare const gizmos: {\n${gizmoProperties.join("\n")}\n};`);

    return parts.join("\n");
  }

  /**
   * Check if any gizmos are loaded
   */
  hasGizmos(): boolean {
    return this.gizmos.size > 0;
  }

  /**
   * Get the list of loaded gizmo names
   */
  getGizmoNames(): string[] {
    return Array.from(this.gizmos.keys());
  }
}
