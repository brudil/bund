import React from "react";
import { Text } from "ink";

interface Props {
  children: string;
}

interface TextSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dimColor?: boolean;
}

/**
 * Parse a line of text into styled spans
 */
function parseInlineStyles(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Bold: **text** or __text__
    const boldMatch = remaining.match(/^(\*\*|__)(.+?)\1/);
    if (boldMatch?.[2]) {
      spans.push({ text: boldMatch[2], bold: true });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: *text* or _text_
    const italicMatch = remaining.match(/^(\*|_)(.+?)\1/);
    if (italicMatch?.[2]) {
      spans.push({ text: italicMatch[2], italic: true });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Inline code: `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch?.[1]) {
      spans.push({ text: codeMatch[1], dimColor: true });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Find next special character
    const nextSpecial = remaining.search(/[\*_`]/);
    if (nextSpecial === -1) {
      // No more special chars, add rest as plain text
      spans.push({ text: remaining });
      break;
    } else if (nextSpecial === 0) {
      // Special char that didn't match a pattern, treat as literal
      spans.push({ text: remaining[0]! });
      remaining = remaining.slice(1);
    } else {
      // Add text up to special char
      spans.push({ text: remaining.slice(0, nextSpecial) });
      remaining = remaining.slice(nextSpecial);
    }
  }

  return spans;
}

/**
 * Parse markdown into lines with styling
 */
function parseMarkdown(content: string): { spans: TextSpan[]; isHeading: boolean }[] {
  const lines = content.split("\n");
  const result: { spans: TextSpan[]; isHeading: boolean }[] = [];

  for (const line of lines) {
    // Heading: # text, ## text, etc. - render as underlined
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch?.[2]) {
      result.push({
        spans: [{ text: headingMatch[2], underline: true, bold: true }],
        isHeading: true,
      });
      continue;
    }

    // Regular line - parse inline styles
    result.push({
      spans: parseInlineStyles(line),
      isHeading: false,
    });
  }

  return result;
}

/**
 * Render a single span with its styling
 */
function renderSpan(span: TextSpan, key: number): React.ReactNode {
  return (
    <Text
      key={key}
      bold={span.bold}
      italic={span.italic}
      underline={span.underline}
      dimColor={span.dimColor}
    >
      {span.text}
    </Text>
  );
}

/**
 * Markdown renderer for terminal output
 * Supports: **bold**, *italic*, `code`, # headings (as underlined)
 */
export function Markdown({ children }: Props) {
  const parsed = parseMarkdown(children);

  // Flatten all spans with newlines between lines into a single Text
  const allSpans: React.ReactNode[] = [];
  let key = 0;

  for (let lineIndex = 0; lineIndex < parsed.length; lineIndex++) {
    const line = parsed[lineIndex]!;
    for (const span of line.spans) {
      allSpans.push(renderSpan(span, key++));
    }
    if (lineIndex < parsed.length - 1) {
      allSpans.push("\n");
    }
  }

  return <Text>{allSpans}</Text>;
}
