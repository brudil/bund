// Serialization - converts runtime values to TypeScript literals

import { inferType, type TypeInfo } from "./type-inference";

const MAX_SERIALIZATION_SIZE = 50000; // 50KB limit

export interface SerializeResult {
  code: string;
  serializable: boolean;
  reason?: "too-large" | "non-serializable" | "circular";
  byteSize?: number;
  typeInfo?: TypeInfo;
}

/**
 * Format byte size for display (e.g., "45KB")
 */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Serialize a value to TypeScript literal with full metadata
 */
export function serializeValue(value: unknown, name?: string): SerializeResult {
  if (value === null) {
    return { code: "null", serializable: true };
  }

  if (value === undefined) {
    return { code: "undefined", serializable: true };
  }

  const type = typeof value;

  if (type === "string") {
    return { code: JSON.stringify(value), serializable: true };
  }

  if (type === "number" || type === "boolean") {
    return { code: String(value), serializable: true };
  }

  if (type === "bigint") {
    return { code: `${value}n`, serializable: true };
  }

  if (type === "function") {
    // Preserve function source
    return { code: String(value), serializable: true };
  }

  if (value instanceof Date) {
    return {
      code: `new Date("${value.toISOString()}")`,
      serializable: true,
    };
  }

  if (value instanceof RegExp) {
    return { code: String(value), serializable: true };
  }

  if (Array.isArray(value)) {
    try {
      const json = JSON.stringify(value);
      if (json.length > MAX_SERIALIZATION_SIZE) {
        const typeInfo = inferType(value, name);
        return {
          code: "",
          serializable: false,
          reason: "too-large",
          byteSize: json.length,
          typeInfo,
        };
      }
      return { code: json, serializable: true };
    } catch {
      const typeInfo = inferType(value, name);
      return {
        code: "",
        serializable: false,
        reason: "circular",
        typeInfo,
      };
    }
  }

  if (type === "object") {
    // Check for common non-serializable types
    const constructorName = (value as object).constructor?.name;
    if (
      constructorName &&
      !["Object", "Array"].includes(constructorName) &&
      constructorName !== "Date" &&
      constructorName !== "RegExp"
    ) {
      return {
        code: "",
        serializable: false,
        reason: "non-serializable",
        typeInfo: { typeName: constructorName },
      };
    }

    try {
      const json = JSON.stringify(value);
      if (json.length > MAX_SERIALIZATION_SIZE) {
        const typeInfo = inferType(value, name);
        return {
          code: "",
          serializable: false,
          reason: "too-large",
          byteSize: json.length,
          typeInfo,
        };
      }
      return { code: json, serializable: true };
    } catch {
      const typeInfo = inferType(value, name);
      return {
        code: "",
        serializable: false,
        reason: "circular",
        typeInfo,
      };
    }
  }

  if (type === "symbol") {
    return {
      code: "",
      serializable: false,
      reason: "non-serializable",
      typeInfo: { typeName: "symbol" },
    };
  }

  return {
    code: "",
    serializable: false,
    reason: "non-serializable",
    typeInfo: { typeName: "unknown" },
  };
}

/**
 * Simplified serialization for subagent context
 * Returns a TypeScript literal or undefined with comment for non-serializable values
 */
export function serializeForContext(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  const type = typeof value;

  if (type === "string") return JSON.stringify(value);
  if (type === "number" || type === "boolean") return String(value);
  if (type === "bigint") return `${value}n`;

  if (value instanceof Date) {
    return `new Date("${value.toISOString()}")`;
  }

  if (value instanceof RegExp) {
    return String(value);
  }

  if (Array.isArray(value)) {
    try {
      const json = JSON.stringify(value, null, 2);
      if (json.length > MAX_SERIALIZATION_SIZE) {
        return `undefined /* [Array(${value.length}) - too large for subagent] */`;
      }
      return json;
    } catch {
      return `undefined /* [Array with circular refs] */`;
    }
  }

  if (type === "object") {
    try {
      const json = JSON.stringify(value, null, 2);
      if (json.length > MAX_SERIALIZATION_SIZE) {
        return `undefined /* [Object - too large for subagent] */`;
      }
      return json;
    } catch {
      return `undefined /* [Object with circular refs] */`;
    }
  }

  if (type === "function") {
    return `undefined /* [Function] */`;
  }

  if (type === "symbol") {
    return `undefined /* [Symbol] */`;
  }

  return `undefined /* [unknown] */`;
}
