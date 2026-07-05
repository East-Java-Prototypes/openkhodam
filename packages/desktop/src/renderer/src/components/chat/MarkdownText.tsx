import type { JSX } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cn } from '@/lib/utils'

const allowedMarkdownElements = ['p', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'br']

const markdownComponents: Components = {
  p({ children }) {
    return <p className="mb-3 leading-7 last:mb-0">{children}</p>
  },
  strong({ children }) {
    return <strong className="font-semibold">{children}</strong>
  },
  em({ children }) {
    return <em className="italic">{children}</em>
  },
  ul({ children }) {
    return <ul className="my-3 list-disc space-y-1 pl-5 leading-7">{children}</ul>
  },
  ol({ children }) {
    return <ol className="my-3 list-decimal space-y-1 pl-5 leading-7">{children}</ol>
  },
  li({ children }) {
    return <li className="pl-1">{children}</li>
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
          isBlock ? 'text-xs leading-5' : 'bg-muted px-1 py-0.5 text-[0.85em]',
          className
        )}
      >
        {children}
      </code>
    )
  },
  pre({ children }) {
    return (
      <pre className="my-3 overflow-x-auto whitespace-pre-wrap break-words border border-border bg-muted/60 p-3 font-mono text-xs leading-5">
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
