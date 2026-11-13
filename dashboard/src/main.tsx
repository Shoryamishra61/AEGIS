import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { AuthProvider } from "./auth";
import { DrawerProvider, ToastProvider } from "./ui";
import { installDemoBackend, isDemoMode } from "./demo/backend";
import "./styles/tokens.css";
import "./styles.css";
import "./ledger.css";

// Static deploys (GitHub Pages / Vercel) run against the in-browser demo
// backend instead of the control plane. Install before any fetch happens.
if (isDemoMode()) installDemoBackend();

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 3_000, retry: 1 } } });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        <ToastProvider>
          <DrawerProvider>
            <App />
          </DrawerProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
