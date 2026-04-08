declare module 'marked-terminal' {
  import type { MarkedExtension } from 'marked';

  interface TerminalRendererOptions {
    code?: (code: string, lang: string) => string;
    blockquote?: (quote: string) => string;
    html?: (html: string) => string;
    heading?: (text: string, level: number) => string;
    hr?: () => string;
    list?: (body: string, ordered: boolean) => string;
    listitem?: (text: string) => string;
    paragraph?: (text: string) => string;
    table?: (header: string, body: string) => string;
    tablerow?: (content: string) => string;
    tablecell?: (content: string, flags: object) => string;
    strong?: (text: string) => string;
    em?: (text: string) => string;
    codespan?: (code: string) => string;
    br?: () => string;
    del?: (text: string) => string;
    link?: (href: string, title: string, text: string) => string;
    image?: (href: string, title: string, text: string) => string;
    tab?: number;
    emoji?: boolean;
    width?: number;
    showSectionPrefix?: boolean;
    unescape?: boolean;
    linebreak?: string;
    firstHeading?: unknown;
    tableOptions?: object;
    codeBlockStyle?: 'auto' | 'fenced';
  }

  export function markedTerminal(options?: TerminalRendererOptions): MarkedExtension;
}
