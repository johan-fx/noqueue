import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { detectRuntime } from './app/bootstrap/runtime'
import { configureNativeViewport } from './app/bootstrap/native-viewport'

configureNativeViewport(detectRuntime() === 'native')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
