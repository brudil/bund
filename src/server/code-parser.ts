// Code parser - extracts declarations from TypeScript/JavaScript code using ts-morph

import { Project, VariableDeclarationKind, type FunctionDeclaration } from "ts-morph";

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [CODE-PARSER] ${msg}`);
}

export interface ParsedDeclaration {
  name: string;
  type: "const" | "let" | "function" | "variable";
  source: string;
  signature?: string;
}

// Shared ts-morph project instance
const project = new Project({
  useInMemoryFileSystem: true,
  compilerOptions: {
    target: 2, // ES2015
    module: 1, // CommonJS
  },
});

/**
 * Extract a function signature from a FunctionDeclaration
 */
function extractSignature(func: FunctionDeclaration): string {
  const name = func.getName() || "anonymous";
  const params = func
    .getParameters()
    .map((p) => p.getText())
    .join(", ");

  // Try to get explicit return type, otherwise infer it
  const returnTypeNode = func.getReturnTypeNode();
  let returnType: string;
  if (returnTypeNode) {
    returnType = returnTypeNode.getText();
  } else {
    // Infer return type from the function
    returnType = func.getReturnType().getText();
    // Clean up complex inferred types
    if (returnType.length > 100) {
      returnType = "unknown";
    }
  }

  const asyncKeyword = func.isAsync() ? "async " : "";
  return `declare ${asyncKeyword}function ${name}(${params}): ${returnType};`;
}

/**
 * Parse code to extract declarations using ts-morph
 * ts-morph properly parses the AST so it only finds real top-level declarations,
 * not text inside string literals
 */
export function parseDeclarations(code: string, builtins: Set<string>): ParsedDeclaration[] {
  log(`parseDeclarations START (${code.length} chars)`);
  const declarations: ParsedDeclaration[] = [];

  try {
    // Create a temporary source file
    log("Creating ts-morph source file...");
    const sourceFile = project.createSourceFile(`temp_${Date.now()}.ts`, code, { overwrite: true });
    log("Source file created");

    // Find variable declarations
    log("Extracting variable statements...");
    const varStatements = sourceFile.getVariableStatements();
    log(`Found ${varStatements.length} variable statements`);
    for (const statement of varStatements) {
      const declarationKind = statement.getDeclarationKind();
      const type =
        declarationKind === VariableDeclarationKind.Const
          ? "const"
          : declarationKind === VariableDeclarationKind.Let
            ? "let"
            : "variable";

      for (const declaration of statement.getDeclarations()) {
        const name = declaration.getName();
        // Skip builtins and destructuring patterns
        if (!builtins.has(name) && !name.includes("{")) {
          declarations.push({
            name,
            type,
            source: statement.getText(),
          });
        }
      }
    }

    // Find function declarations
    log("Extracting function declarations...");
    const functions = sourceFile.getFunctions();
    log(`Found ${functions.length} functions`);
    for (const func of functions) {
      const name = func.getName();
      if (name && !builtins.has(name)) {
        declarations.push({
          name,
          type: "function",
          source: func.getText(),
          signature: extractSignature(func),
        });
      }
    }

    // Clean up
    log("Deleting source file...");
    sourceFile.delete();
    log("Source file deleted");
  } catch (e) {
    // If parsing fails, log the error but return empty - don't use buggy regex fallback
    log(`ts-morph parsing failed: ${e}`);
    return [];
  }

  log(`parseDeclarations END: ${declarations.length} declarations found`);
  return declarations;
}

/**
 * Parse deletions from code (both `delete x` and `Harness.gc('x')`)
 */
export function parseDeletions(code: string): string[] {
  const deletions: string[] = [];

  // Match `delete varName;`
  const deleteRegex = /delete\s+(\w+)\s*;?/g;
  let match;
  while ((match = deleteRegex.exec(code)) !== null) {
    const name = match[1];
    if (name) {
      deletions.push(name);
    }
  }

  // Match `Harness.gc('varName')` or `Harness.gc("varName")`
  // Only captures the top-level variable (first part before any dot)
  const harnessGcRegex = /Harness\.gc\(\s*['"]([^'"]+)['"]/g;
  while ((match = harnessGcRegex.exec(code)) !== null) {
    const path = match[1];
    if (path) {
      // For simple vars (no dots), delete the whole thing
      // For paths like 'data.items', we still track 'data' but don't delete it entirely
      if (!path.includes(".")) {
        deletions.push(path);
      }
      // Note: nested property deletions don't remove from materializer state
      // since the parent object still exists
    }
  }

  return deletions;
}
