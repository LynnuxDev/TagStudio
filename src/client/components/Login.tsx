import { useState, useEffect } from 'react'

interface LoginProps {
  onAuth: () => void
}

export default function Login({ onAuth }: LoginProps) {
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [signupDisabled, setSignupDisabled] = useState(false)

  useEffect(() => {
    fetch('/api/users/global-settings', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.settings?.disable_signup === 'true') setSignupDisabled(true)
      })
      .catch(() => {})
  }, [])

  const { signIn, signUp } = (window as any).__api__()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      if (isSignUp) {
        await signUp(email, password, name || undefined)
      } else {
        await signIn(email, password)
      }
      onAuth()
    } catch (err: any) {
      setError(err.message)
    }
  }

  return (
    <div className="login-container">
      <form className="login-form" onSubmit={handleSubmit}>
        <h1>Tagger</h1>
        <p className="login-subtitle">Metadata File Manager</p>
        {isSignUp && (
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="login-error">{error}</p>}
        <button type="submit">{isSignUp ? 'Sign Up' : 'Sign In'}</button>
        {signupDisabled ? null : (
          <p className="login-toggle" onClick={() => setIsSignUp(!isSignUp)}>
            {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </p>
        )}
      </form>
    </div>
  )
}
