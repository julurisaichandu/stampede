import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './tokens.css'
import App from './App.tsx'

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

// Hold the first paint for the hero's faces so the stamp press lands on set type, not a fallback serif.
const faces = ['480 1em "Fraunces Variable"', 'italic 480 1em "Fraunces Variable"'].map((f) => document.fonts.load(f))
const timeout = new Promise((done) => setTimeout(done, 800))
Promise.race([Promise.all(faces), timeout]).finally(render)
