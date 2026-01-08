// @ts-nocheck
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// 简单的错误边界组件，用于捕获渲染错误
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error("ErrorBoundary caught:", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{color:'red', padding:'20px', fontFamily:'sans-serif'}}>
          <h2>应用程序发生错误 (Application Error)</h2>
          <pre style={{background:'#fee', padding:'10px', borderRadius:'4px'}}>{this.state.error?.toString()}</pre>
          <p>请查看控制台 (F12) 获取更多详细信息。</p>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
    document.body.innerHTML = '<div style="color:red;padding:20px">FATAL ERROR: Could not find root element.</div>';
    throw new Error("Root element not found");
}

console.log("Attempting to mount React app...");

try {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
  console.log("React mount call completed.");
} catch (e) {
  console.error("Startup Error:", e);
  rootElement.innerHTML = `<div style="color:red;padding:20px"><h1>Startup Error</h1><pre>${e.toString()}</pre></div>`;
}
