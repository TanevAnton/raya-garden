import { Component } from "react";

// If anything on the page throws while drawing, React removes the whole
// page: a black screen, and no way back but a reload nobody thinks of in the
// middle of service. This catches it and says so, with the reload as a
// button. Orders are safe either way — they live on the server.
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("[qr] page error:", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { title, text, button } = this.props;
    return (
      <div role="alert" className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="font-display text-3xl text-cream-50">{title}</h1>
          <p className="text-cream-100/70 mt-3">{text}</p>
          <button type="button" onClick={() => window.location.reload()} className="btn-gold mt-6 w-full py-4 rounded-sm text-sm tracking-[0.2em] uppercase font-medium">
            {button}
          </button>
        </div>
      </div>
    );
  }
}
