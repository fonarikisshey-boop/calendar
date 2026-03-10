import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './version.js'

console.log('MAIN.JX LOADED - v1.0.2 BUILD 20 - TIMESTAMP: ' + Date.now())

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
