import React, { useEffect, useMemo, useState } from 'react'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import Markdown from 'react-markdown'
import styles from './TextPreview.module.css'

const TEXT_PREVIEW = /\.(txt|md|csv|json|py|js|ts|swift|rs|go|sh|ya?ml|html|css|log|xml|toml|ini)$/i
const MAX_TABLE_ROWS = 50

// Core build with only the languages we preview keeps the bundle small and
// highlighting synchronous, so large previews never wait on a worker.
const LANGUAGES = { bash, css, go, ini, javascript, json, python, rust, swift, typescript, xml, yaml }
for (const [name, definition] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, definition)

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  ts: 'typescript',
  swift: 'swift',
  rs: 'rust',
  go: 'go',
  sh: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  html: 'xml',
  xml: 'xml',
  css: 'css',
  json: 'json',
  toml: 'ini',
  ini: 'ini',
}
const MAX_SNIPPET_CHARS = 700

export const hasTextPreview = (path: string) => TEXT_PREVIEW.test(path)

function extensionOf(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1).toLowerCase()
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"' && quoted && line[i + 1] === '"') {
      cell += '"'
      i++
    } else if (ch === '"') {
      quoted = !quoted
    } else if (ch === ',' && !quoted) {
      cells.push(cell)
      cell = ''
    } else {
      cell += ch
    }
  }
  cells.push(cell)
  return cells
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

const CsvTable: React.FC<{ text: string }> = ({ text }) => {
  const rows = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .slice(0, MAX_TABLE_ROWS + 1)
        .map(parseCsvLine),
    [text]
  )
  const [header, ...body] = rows
  if (!header) return null
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th key={i}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const CodeBlock: React.FC<{ source: string; language?: string }> = ({ source, language }) => {
  const highlighted = useMemo(
    () => (language ? hljs.highlight(source, { language, ignoreIllegals: true }).value : null),
    [source, language]
  )
  if (highlighted === null) return <pre className={styles.code}>{source}</pre>
  return <pre className={styles.code} dangerouslySetInnerHTML={{ __html: highlighted }} />
}

interface TextPreviewProps {
  path: string
  snippet: string
}

// Fetches the start of the file and renders it by type: markdown, JSON, CSV
// table, syntax-highlighted code, or plain monospace. Falls back to the indexed snippet.
export const TextPreview: React.FC<TextPreviewProps> = ({ path, snippet }) => {
  const [loaded, setLoaded] = useState<{ path: string; text: string } | null>(null)

  useEffect(() => {
    if (!hasTextPreview(path)) return
    let cancelled = false
    fetch(`/api/text?path=${encodeURIComponent(path)}`)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((text) => {
        if (!cancelled) setLoaded({ path, text })
      })
      .catch(() => {
        if (!cancelled) setLoaded(null)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  const text = loaded?.path === path ? loaded.text : null
  if (text === null) {
    return <p className={styles.plain}>{snippet.slice(0, MAX_SNIPPET_CHARS)}</p>
  }

  const ext = extensionOf(path)
  if (ext === 'md') {
    return (
      <div className={styles.markdown}>
        <Markdown>{text}</Markdown>
      </div>
    )
  }
  if (ext === 'csv') return <CsvTable text={text} />
  const source = ext === 'json' ? prettyJson(text) : text
  return <CodeBlock source={source} language={LANGUAGE_BY_EXTENSION[ext]} />
}
