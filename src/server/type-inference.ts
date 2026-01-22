// Type inference - infers TypeScript types from runtime values

export interface TypeInfo {
  typeName: string;
  interfaceDecl?: string;
}

/**
 * Convert a string to PascalCase for type names
 */
export function pascalCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Infer TypeScript type from a runtime value
 * Returns interface definition for objects/arrays, or simple type name
 */
export function inferType(value: unknown, name?: string): TypeInfo {
  if (value === null) return { typeName: "null" };
  if (value === undefined) return { typeName: "undefined" };

  const type = typeof value;
  if (type === "string") return { typeName: "string" };
  if (type === "number") return { typeName: "number" };
  if (type === "boolean") return { typeName: "boolean" };
  if (type === "bigint") return { typeName: "bigint" };
  if (type === "symbol") return { typeName: "symbol" };
  if (type === "function") return { typeName: "Function" };

  if (value instanceof Date) return { typeName: "Date" };
  if (value instanceof RegExp) return { typeName: "RegExp" };

  // For objects with custom constructors (Response, Request, etc.)
  const constructorName = (value as object).constructor?.name;
  if (constructorName && !["Object", "Array"].includes(constructorName)) {
    return { typeName: constructorName };
  }

  if (Array.isArray(value)) {
    return inferArrayType(value, name);
  }

  // Plain object - generate interface
  return inferObjectType(value as Record<string, unknown>, name);
}

/**
 * Infer TypeScript type for an array
 */
function inferArrayType(arr: unknown[], name?: string): TypeInfo {
  if (arr.length === 0) return { typeName: "unknown[]" };

  // Sample first element to infer item type
  const first = arr[0];
  const itemType = inferType(first);

  if (itemType.interfaceDecl) {
    const itemTypeName = name ? `${pascalCase(name)}Item` : "Item";
    return {
      typeName: `${itemTypeName}[]`,
      interfaceDecl: itemType.interfaceDecl.replace(/^interface \w+/, `interface ${itemTypeName}`),
    };
  }

  return { typeName: `${itemType.typeName}[]` };
}

/**
 * Infer TypeScript interface for a plain object
 */
function inferObjectType(obj: Record<string, unknown>, name?: string): TypeInfo {
  const typeName = name ? pascalCase(name) : "InferredType";
  const props: string[] = [];

  for (const [key, val] of Object.entries(obj)) {
    const propType = inferType(val);
    // Use safe key syntax for non-identifier keys
    const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
    props.push(`  ${safeKey}: ${propType.typeName};`);
  }

  // Limit interface size to avoid overwhelming output
  if (props.length > 20) {
    const truncated = props.slice(0, 15);
    truncated.push(`  // ... ${props.length - 15} more properties`);
    return {
      typeName,
      interfaceDecl: `interface ${typeName} {\n${truncated.join("\n")}\n}`,
    };
  }

  return {
    typeName,
    interfaceDecl: `interface ${typeName} {\n${props.join("\n")}\n}`,
  };
}
