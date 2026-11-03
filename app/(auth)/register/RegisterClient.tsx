'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function RegisterClient() {
  const router = useRouter()
  const [form, setForm] = useState({ email: '', password: '', full_name: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { full_name: form.full_name } },
    })
    if (error) { setError(error.message); setLoading(false) }
    else router.push('/dashboard')
  }

  const field = (key: keyof typeof form, label: string, type = 'text', placeholder = '') => (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </label>
      <input
        type={type} value={form[key]} placeholder={placeholder} required
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        style={{
          width: '100%', padding: '10px 12px', background: 'var(--surface-2)',
          border: '1px solid var(--border)', borderRadius: 8,
          color: 'var(--text)', fontSize: 14, outline: 'none',
        }}
      />
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ width: 360, padding: '40px 32px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 12 }}>🏷️</div>
          <h1 style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 22, fontWeight: 700 }}>Join the team</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>Create your CRM account</p>
        </div>

        <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {field('full_name', 'Full Name', 'text', 'Jane Smith')}
          {field('email', 'Email', 'email', 'you@signarama-corona.com')}
          {field('password', 'Password', 'password', '••••••••')}

          {error && <p style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', padding: '8px 12px', borderRadius: 8, fontSize: 13 }}>{error}</p>}

          <button type="submit" disabled={loading}
            style={{ marginTop: 4, padding: 11, background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--text-secondary)' }}>
          Already have an account?{' '}
          <a href="/login" style={{ color: 'var(--primary)', textDecoration: 'none' }}>Sign in</a>
        </p>
      </div>
    </div>
  )
}
