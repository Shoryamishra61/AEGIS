import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { AuthProvider } from "./auth";
import { DrawerProvider, ToastProvider } from "./ui";
import "./styles/tokens.css";
import "./styles.css";
import "./ledger.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 3_000, retry: 1 } } });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
    <BrowserRouter>
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
