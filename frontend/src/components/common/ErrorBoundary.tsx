import React from 'react'

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('UI crashed:', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" style={{ padding: '2rem', textAlign: 'center', color: 'var(--label)' }}>
        <p style={{ fontWeight: 600, margin: '0 0 0.5rem' }}>Something went wrong displaying this screen.</p>
        <p style={{ color: 'var(--label-2)', margin: '0 0 1rem', fontSize: '0.8125rem' }}>
          Your index and history are safe. Reload to recover.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            height: '1.75rem',
            padding: '0 0.875rem',
            borderRadius: '9999px',
            border: '0.5px solid var(--separator)',
            background: 'var(--accent)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    )
  }
}
