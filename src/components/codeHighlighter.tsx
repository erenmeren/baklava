import React, { useEffect, useRef, FC } from "react"
import hljs from "highlight.js"

interface Props {
  language: string
  children: string
}

const CodeHighlighter: FC<Props> = ({ language, children }) => {
  const codeRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (codeRef.current) {
      hljs.highlightElement(codeRef.current)
    }
  }, [children])

  return (
    <pre>
      <code ref={codeRef} className={language}>
        {children}
      </code>
    </pre>
  )
}

export default CodeHighlighter
