import type { JSX } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cn } from '@/lib/utils'

const allowedMarkdownElements = ['p', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'br']

const markdownComponents: Components = {
  p({ children }) {
    return <p className="mb-2.5 leading-6 last:mb-0">{children}</p>
  },
  strong({ children }) {
    return <strong className="font-semibold">{children}</strong>
  },
  em({ children }) {
    return <em className="italic">{children}</em>
  },
  ul({ children }) {
    return <ul className="my-2.5 list-disc space-y-1.5 pl-5 leading-6">{children}</ul>
  },
  ol({ children }) {
    return <ol className="my-2.5 list-decimal space-y-1.5 pl-5 leading-6">{children}</ol>
  },
  li({ children }) {
    return <li className="pl-1 marker:text-muted-foreground">{children}</li>
  },
  a({ children, href }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-primary"
      >
        {children}
      </a>
    )
  },
  code({ children, className, ...props }) {
    const isBlock = className?.startsWith('language-') || String(children).includes('\n')
    return (
      <code
        {...props}
        className={cn(
          'font-mono',
          isBlock
            ? 'block min-w-full text-[0.8125rem] leading-5 text-foreground/90'
            : 'rounded-sm border border-border/60 bg-muted/70 px-1.5 py-0.5 text-[0.85em] text-foreground',
          className
        )}
      >
        {children}
      </code>
    )
  },
  pre({ children }) {
    return (
      <pre className="my-3 max-w-full overflow-x-auto whitespace-pre rounded-md border border-border/70 bg-muted/50 px-3 py-2.5 font-mono text-[0.8125rem] leading-5 text-foreground/90 shadow-inner">
        {children}
      </pre>
    )
  }
}

export function MarkdownText({ text }: { text: string }): JSX.Element {
  return (
    <div className="min-w-0 break-words">
      <ReactMarkdown
        allowedElements={allowedMarkdownElements}
        components={markdownComponents}
        remarkPlugins={[remarkGfm]}
        skipHtml
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
